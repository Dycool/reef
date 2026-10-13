// once again this code is inspired by dycool/nso-webapp, and has improvements in many areas

import { randomUUID } from 'node:crypto';
import { and, eq, lt } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { gameWebServiceTokens, gameWebviewSessions } from '$lib/server/db/schema';
import { buildWebviewHtml } from '$lib/server/standalone-webview';
import {
	NOOKLINK_API_ORIGIN,
	NOOKLINK_DPL_ORIGIN,
	SMASH_WORLD_CDN_ORIGIN,
	SPLATNET3_API_ORIGIN,
	isStrictNintendoOrigin,
	isOriginWhitelisted
} from '$lib/server/webviewDomains';
import type { GameService, GameServiceSession } from '$lib/types/game-services';
import {
	isZeldaNotes,
	isNookLink,
	isSmashWorld,
	isSplatNet2,
	patchZeldaNotesJavascript,
	rewriteNookLinkApiOrigin
} from './game-service-compat';
import {
	createUpstreamHeaders,
	createZeldaBootstrapHeaders,
	createSplatNet2BootstrapHeaders
} from './game-webview-headers';
import { CookieJar } from './webview-cookie-jar';
import { gameWebviewLaunchPath } from './game-webview-routing';
import {
	gameAssetCacheControl,
	reusableGameAsset,
	immutableGameAsset
} from './game-webview-assets';

const SESSION_LIFETIME = 2 * 60 * 60 * 1000;
const SPLATNET3_ID = 4834290508791808;
const cookieWrites = new Map<string, Promise<void>>();

type GameWebviewSession = typeof gameWebviewSessions.$inferSelect;

export async function createGameWebviewSession(
	accountId: string,
	service: GameService,
	language: string,
	country: string,
	gameWebToken: string
): Promise<GameServiceSession> {
	const initialUrl = new URL(service.uri);
	if (!isStrictNintendoUrl(initialUrl)) throw new Error('Nintendo service URL is not allowed');

	const id = randomUUID();
	const expiresAt = new Date(Date.now() + SESSION_LIFETIME);
	const allowedOrigins = resolveAllowedOrigins(service);
	if (!initialUrl.searchParams.has('lang')) initialUrl.searchParams.set('lang', language);
	if (!initialUrl.searchParams.has('na_lang')) initialUrl.searchParams.set('na_lang', language);
	if (!initialUrl.searchParams.has('na_country'))
		initialUrl.searchParams.set('na_country', country);
	const browserService =
		isNookLink({ serviceId: service.id, serviceUri: service.uri }) ||
		isSmashWorld({ serviceId: service.id, serviceUri: service.uri }) ||
		isSplatNet2({ serviceId: service.id, serviceUri: service.uri });
	const serviceUri = browserService ? service.uri : initialUrl.toString();
	const cookieJar = new CookieJar([]);
	if (isSplatNet2({ serviceId: service.id, serviceUri })) {
		// The extension prewarms authentication, installs its cookies and opens
		// /home explicitly. Do not depend on the bootstrap page navigating itself.
		try {
			const bootstrap = await fetch(initialUrl.toString(), {
				headers: createSplatNet2BootstrapHeaders(gameWebToken, language, country),
				redirect: 'follow'
			});
			for (const value of getSetCookies(bootstrap.headers)) {
				cookieJar.addSetCookie(value, initialUrl);
				if (bootstrap.url) cookieJar.addSetCookie(value, new URL(bootstrap.url));
			}
			await bootstrap.body?.cancel();
		} catch (cause) {
			console.warn(
				'[GameWebviewProxy] SplatNet 2 prewarm failed',
				cause instanceof Error ? cause.message : String(cause)
			);
		}
		initialUrl.pathname = '/home';
	} else if (isZeldaNotes({ serviceId: service.id, serviceUri })) {
		// Authenticate the exact launch URI before opening the title selector, as
		// nso-worker-backend does. The selector needs the bootstrap session cookie.
		try {
			const bootstrap = await fetch(initialUrl.toString(), {
				method: 'GET',
				headers: createZeldaBootstrapHeaders(gameWebToken, language),
				redirect: 'manual'
			});
			for (const value of getSetCookies(bootstrap.headers))
				cookieJar.addSetCookie(value, initialUrl);
			await bootstrap.body?.cancel();
			initialUrl.pathname = '/title-select';
		} catch (cause) {
			console.warn(
				'[GameWebviewProxy] Zelda bootstrap failed',
				cause instanceof Error ? cause.message : String(cause)
			);
		}
	}

	await db.delete(gameWebviewSessions).where(lt(gameWebviewSessions.expiresAt, new Date()));
	await db.insert(gameWebviewSessions).values({
		id,
		nintendoAccountId: accountId,
		serviceId: service.id,
		serviceUri,
		allowedOrigins,
		language,
		country,
		cookies: cookieJar.toJSON(),
		expiresAt
	});

	return {
		sessionId: id,
		webviewUrl:
			isNookLink({ serviceId: service.id, serviceUri }) ||
			isSplatNet2({ serviceId: service.id, serviceUri })
				? gameWebviewLaunchPath(
						initialUrl,
						id,
						isNookLink({ serviceId: service.id, serviceUri }) ? 'reef_nooklink' : undefined
					)
				: `/api/nso/webview/${id}/proxy?url=${encodeURIComponent(initialUrl.toString())}`,
		expiresAt: expiresAt.getTime()
	};
}

export async function closeGameWebviewSession(accountId: string, sessionId: string): Promise<void> {
	await db
		.delete(gameWebviewSessions)
		.where(
			and(
				eq(gameWebviewSessions.id, sessionId),
				eq(gameWebviewSessions.nintendoAccountId, accountId)
			)
		);
}

export async function getGameWebviewSession(
	accountId: string,
	sessionId: string
): Promise<GameWebviewSession | null> {
	const session = await db
		.select()
		.from(gameWebviewSessions)
		.where(
			and(
				eq(gameWebviewSessions.id, sessionId),
				eq(gameWebviewSessions.nintendoAccountId, accountId)
			)
		)
		.get();

	if (!session) return null;
	if (session.expiresAt.getTime() > Date.now()) return session;
	await closeGameWebviewSession(accountId, sessionId);
	return null;
}

export async function proxyGameWebviewRequest(
	request: Request,
	accountId: string,
	sessionId: string,
	restPath = ''
): Promise<Response> {
	const session = await getGameWebviewSession(accountId, sessionId);
	if (!session) return new Response('Game-service session expired.', { status: 401 });

	const requestUrl = new URL(request.url);
	const browserService = isNookLink(session) || isSmashWorld(session) || isSplatNet2(session);
	let explicitUrl = restPath && !browserService ? null : requestUrl.searchParams.get('url');
	if (!explicitUrl && browserService) {
		const originPath = restPath.match(/^__origin\/([^/]+)(\/.*)?$/);
		if (originPath)
			explicitUrl = `https://${decodeURIComponent(originPath[1])}${originPath[2] || '/'}${requestUrl.search}`;
	}

	let targetUrl: URL;

	try {
		if (explicitUrl) {
			targetUrl = new URL(explicitUrl.replace(/&amp;/gi, '&'));

			for (const [name, value] of requestUrl.searchParams) {
				if (name !== 'url' && !browserService) targetUrl.searchParams.set(name, value);
			}
		} else {
			const path = `/${restPath}`.replace(/\/{2,}/g, '/');
			const base =
				isNookLink(session) && /^\/api\/sd\/v1(?:\/|$)/.test(path)
					? NOOKLINK_API_ORIGIN
					: new URL(session.serviceUri).origin;
			targetUrl = new URL(`${path}${requestUrl.search}`, base);
		}
	} catch {
		return new Response('Invalid game-service URL.', { status: 400 });
	}

	if (
		!isAllowedServiceUrl(
			session,
			targetUrl,
			request.method,
			request.headers.get('sec-fetch-dest') || ''
		)
	) {
		return new Response('Game-service destination is not allowed.', { status: 403 });
	}
	if (isZeldaNotes(session) && targetUrl.pathname === '/') {
		targetUrl.pathname = '/title-select';
		return new Response(null, {
			status: 302,
			headers: {
				location: `/api/nso/webview/${session.id}/proxy?url=${encodeURIComponent(targetUrl.toString())}`,
				'cache-control': 'private, no-store'
			}
		});
	}

	const token = await db
		.select({ token: gameWebServiceTokens.token, expiresAt: gameWebServiceTokens.expiresAt })
		.from(gameWebServiceTokens)
		.where(
			and(
				eq(gameWebServiceTokens.nintendoAccountId, accountId),
				eq(gameWebServiceTokens.serviceId, session.serviceId)
			)
		)
		.get();
	if (!token || token.expiresAt.getTime() <= Date.now()) {
		return new Response('Game-service token expired.', { status: 401 });
	}

	const cookieJar = new CookieJar(session.cookies);
	const headers = createUpstreamHeaders(
		request.headers,
		session,
		targetUrl,
		cookieJar,
		token.token,
		request.method
	);
	const body = ['GET', 'HEAD'].includes(request.method)
		? undefined
		: new Uint8Array(await request.arrayBuffer());

	let upstream: Response;
	try {
		upstream = await fetch(targetUrl, {
			method: request.method,
			headers,
			body,
			redirect: 'manual',
			signal: request.signal
		});
	} catch (cause) {
		console.warn('[GameWebviewProxy] Nintendo request failed', {
			serviceId: session.serviceId,
			origin: targetUrl.origin,
			path: targetUrl.pathname,
			error: cause instanceof Error ? cause.message : String(cause)
		});
		return new Response('Nintendo game service is unavailable.', { status: 502 });
	}

	await persistResponseCookies(session.id, targetUrl, upstream.headers);
	const responseHeaders = createBrowserHeaders(upstream.headers);
	if (browserService) {
		responseHeaders.set(
			'cache-control',
			['GET', 'HEAD'].includes(request.method)
				? gameAssetCacheControl(targetUrl, upstream)
				: 'no-store'
		);
		for (const cookie of getSetCookies(upstream.headers)) {
			const cleaned = cookie
				.replace(/Domain=[^;]+;?/gi, '')
				.replace(/SameSite=[^;]+;?/gi, '')
				.replace(/Secure;?/gi, '')
				.replace(/;+/g, ';')
				.trim();
			responseHeaders.append(
				'set-cookie',
				`${cleaned}; Secure; SameSite=None; Partitioned; Path=/`
			);
		}
	}
	if (
		isSplatNet2(session) &&
		targetUrl.pathname === '/' &&
		request.method === 'GET' &&
		!session.cookies.some((cookie) => cookie.name === 'iksm_session') &&
		getSetCookies(upstream.headers).some((cookie) => cookie.startsWith('iksm_session=')) &&
		!upstream.headers.has('location')
	) {
		await upstream.body?.cancel();
		targetUrl.pathname = '/home';
		responseHeaders.set(
			'location',
			`/api/nso/webview/${session.id}/proxy?url=${encodeURIComponent(targetUrl.toString())}`
		);
		responseHeaders.set('cache-control', 'no-store');
		return new Response(null, { status: 302, headers: responseHeaders });
	}
	const location = upstream.headers.get('location');
	if (location) {
		try {
			const redirect = new URL(location, targetUrl);
			if (
				isAllowedServiceUrl(session, redirect, 'GET', request.headers.get('sec-fetch-dest') || '')
			) {
				responseHeaders.set(
					'location',
					`/api/nso/webview/${session.id}/proxy?url=${encodeURIComponent(redirect.toString())}`
				);
			} else {
				responseHeaders.delete('location');
			}
		} catch {
			responseHeaders.delete('location');
		}
	}

	if (request.method === 'HEAD' || upstream.status === 204 || upstream.status === 304) {
		return new Response(null, { status: upstream.status, headers: responseHeaders });
	}

	const contentType = upstream.headers.get('content-type') || '';
	const isJavascript =
		/javascript|ecmascript|x-javascript/i.test(contentType) || /\.m?js$/i.test(targetUrl.pathname);
	if (isJavascript && (isZeldaNotes(session) || isNookLink(session))) {
		const source = await upstream.text();
		const patched = isZeldaNotes(session)
			? patchZeldaNotesJavascript(source)
			: rewriteNookLinkApiOrigin(source);
		responseHeaders.delete('etag');
		responseHeaders.delete('last-modified');
		return new Response(patched, { status: upstream.status, headers: responseHeaders });
	}
	if (/text\/html|application\/xhtml\+xml/i.test(contentType)) {
		const source = await upstream.text();
		const html = buildWebviewHtml({
			sessionId: session.id,
			serviceId: String(session.serviceId),
			serviceUri: session.serviceUri,
			currentTargetUrl: targetUrl.toString(),
			allowedOrigins: session.allowedOrigins,
			initialHtml: isNookLink(session) ? rewriteNookLinkApiOrigin(source) : source
		});
		responseHeaders.delete('etag');
		responseHeaders.delete('last-modified');
		return new Response(html, { status: upstream.status, headers: responseHeaders });
	}

	if (!browserService && /text\/css/i.test(contentType)) {
		const css = rewriteCss(await upstream.text(), session, targetUrl);
		responseHeaders.delete('etag');
		responseHeaders.delete('last-modified');
		return new Response(css, { status: upstream.status, headers: responseHeaders });
	}

	return new Response(upstream.body, { status: upstream.status, headers: responseHeaders });
}

/** Keep the same browser cache key across launches, with authentication on misses. */
export async function serveStableGameAsset(
	request: Request,
	accountId: string,
	sessionId: string
): Promise<Response | null> {
	const url = new URL(request.url);
	if (!/^\/api\/nso\/webview-static\/\d+$/.test(url.pathname)) return null;
	if (request.method !== 'GET')
		return new Response('Method Not Allowed', {
			status: 405,
			headers: { Allow: 'GET', 'Cache-Control': 'no-store' }
		});
	let target: URL;
	try {
		target = new URL(url.searchParams.get('url') || '');
	} catch {
		return new Response('Invalid Nintendo static resource.', { status: 400 });
	}
	const kind = reusableGameAsset(target);
	if (!kind) return new Response('Invalid Nintendo static resource.', { status: 400 });
	const session = await getGameWebviewSession(accountId, sessionId);
	if (!session)
		return new Response('Game-service session authentication required.', { status: 401 });
	url.pathname = `/api/nso/webview/${session.id}/proxy`;
	url.search = '';
	url.searchParams.set('url', target.toString());
	const response = await proxyGameWebviewRequest(new Request(url, request), accountId, session.id);
	const headers = new Headers(response.headers);
	const type = headers.get('content-type') || '';
	if (
		response.ok &&
		!headers.has('set-cookie') &&
		(kind === 'script' ? /javascript|ecmascript/i.test(type) : type.startsWith('image/'))
	) {
		const immutable = immutableGameAsset(target);
		const ttl = immutable ? 604800 : kind === 'script' ? 7200 : 86400;
		headers.set('cache-control', `private, max-age=${ttl}${immutable ? ', immutable' : ''}`);
		headers.delete('pragma');
	} else headers.set('cache-control', 'no-store');
	return new Response(response.body, { status: response.status, headers });
}

function createBrowserHeaders(upstream: Headers): Headers {
	const headers = new Headers();
	for (const [name, value] of upstream) {
		if (
			[
				'content-length',
				'content-encoding',
				'transfer-encoding',
				'set-cookie',
				'content-security-policy',
				'content-security-policy-report-only',
				'x-frame-options'
			].includes(name.toLowerCase())
		) {
			continue;
		}
		headers.append(name, value);
	}
	headers.set('cache-control', 'private, no-store');
	headers.set('referrer-policy', 'same-origin');

	return headers;
}

function rewriteCss(css: string, session: GameWebviewSession, targetUrl: URL): string {
	const urls = css.replace(/url\((['"]?)([^)'"\s]+)\1\)/gi, (match, quote, value) => {
		if (/^(?:data:|blob:|#)/i.test(value)) return match;
		return `url(${quote}${toProxyUrl(value, session, targetUrl)}${quote})`;
	});
	return urls.replace(/(@import\s+)(['"])([^'"]+)\2/gi, (match, prefix, quote, value) => {
		if (/^(?:data:|blob:)/i.test(value)) return match;
		return `${prefix}${quote}${toProxyUrl(value, session, targetUrl)}${quote}`;
	});
}

function toProxyUrl(raw: string, session: GameWebviewSession, currentUrl: URL): string {
	if (raw.startsWith('/api/nso/webview/')) return raw;
	try {
		const target = new URL(raw.startsWith('//') ? `https:${raw}` : raw, currentUrl);
		if (!isAllowedServiceUrl(session, target, 'GET')) return raw;
		return `/api/nso/webview/${session.id}/proxy?url=${encodeURIComponent(target.toString())}`;
	} catch {
		return raw;
	}
}

function resolveAllowedOrigins(service: GameService): string[] {
	const values = new Set<string>([new URL(service.uri).origin]);
	for (const entry of service.whiteList) {
		const value = entry.trim().toLowerCase();
		if (!value) continue;
		const host = value.replace(/^https?:\/\//, '').split('/')[0];
		const checkHost = host.startsWith('*.') ? host.slice(2) : host;
		if (isStrictNintendoUrl(new URL(`https://${checkHost}`))) values.add(`https://${host}`);
	}
	if (service.id === SPLATNET3_ID) values.add(SPLATNET3_API_ORIGIN);
	return [...values];
}

function isAllowedServiceUrl(
	session: GameWebviewSession,
	target: URL,
	method: string,
	fetchDest = ''
): boolean {
	if (!isStrictNintendoUrl(target)) return false;
	if (!['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) return false;
	const whitelisted = isOriginWhitelisted(target.origin, session.allowedOrigins);
	if (whitelisted) return true;
	// Match the worker's exact sibling/CDN exceptions for resources. Coral's
	// navigation whitelist is kept separate from these fetch/XHR destinations.
	const isNavigation = ['document', 'iframe', 'frame'].includes(fetchDest.toLowerCase());
	if (isNavigation) return false;
	if (isSmashWorld(session) && target.origin === SMASH_WORLD_CDN_ORIGIN) {
		return method === 'GET' || method === 'HEAD';
	}
	if (isNookLink(session) && [NOOKLINK_API_ORIGIN, NOOKLINK_DPL_ORIGIN].includes(target.origin)) {
		return ['GET', 'HEAD', 'POST'].includes(method);
	}
	return false;
}

function isStrictNintendoUrl(value: URL): boolean {
	return isStrictNintendoOrigin(value.toString());
}

async function persistResponseCookies(sessionId: string, targetUrl: URL, headers: Headers) {
	const setCookies = getSetCookies(headers);
	if (!setCookies.length) return;

	const previous = cookieWrites.get(sessionId) || Promise.resolve();
	const write = previous
		.catch(() => undefined)
		.then(async () => {
			const current = await db
				.select({ cookies: gameWebviewSessions.cookies })
				.from(gameWebviewSessions)
				.where(eq(gameWebviewSessions.id, sessionId))
				.get();
			if (!current) return;
			const jar = new CookieJar(current.cookies);
			for (const value of setCookies) jar.addSetCookie(value, targetUrl);
			await db
				.update(gameWebviewSessions)
				.set({ cookies: jar.toJSON() })
				.where(eq(gameWebviewSessions.id, sessionId));
		})
		.finally(() => {
			if (cookieWrites.get(sessionId) === write) cookieWrites.delete(sessionId);
		});
	cookieWrites.set(sessionId, write);
	await write;
}

function getSetCookies(headers: Headers): string[] {
	const values = (headers as Headers & { getSetCookie?: () => string[] }).getSetCookie?.();
	if (values?.length) return values;
	const value = headers.get('set-cookie');
	return value ? [value] : [];
}
