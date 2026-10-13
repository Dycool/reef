import { env } from '$env/dynamic/private';
import {
	type ServiceIdentity,
	isZeldaNotes,
	isNookLink,
	isSmashWorld,
	isSplatNet2,
	isStaticServiceAsset
} from './game-service-compat';
import type { CookieJar } from './webview-cookie-jar';
const SPLATNET3_ID = 4834290508791808;
const IOS_UA =
	'Mozilla/5.0 (iPhone; CPU iPhone OS 15_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.3 Mobile/15E148 Safari/604.1';

function androidUserAgent(): string {
	return `Mozilla/5.0 (Linux; Android 10; Build/QP1A.190711.020; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/80.0.3987.162 Mobile Safari/537.36 com.nintendo.znca/${env.CORAL_VERSION || '3.5.0'}`;
}

export function createZeldaBootstrapHeaders(token: string, language: string): Headers {
	return new Headers({
		'x-gamewebtoken': token,
		'x-appplatform': 'android',
		'x-appcolorscheme': 'DARK',
		'x-requested-with': 'com.nintendo.znca',
		'accept-language': language,
		'user-agent': androidUserAgent(),
		'upgrade-insecure-requests': '1',
		dnt: '1',
		accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8'
	});
}

/** Matches nso-extension-backend's SplatNet 2 prewarm request. */
export function createSplatNet2BootstrapHeaders(
	token: string,
	language: string,
	country: string
): Headers {
	return new Headers({
		'x-gamewebtoken': token,
		'x-appplatform': 'android',
		'x-appcolorscheme': 'DARK',
		'x-requested-with': 'com.nintendo.znca',
		'x-nacountry': country,
		'accept-language': language,
		'user-agent': androidUserAgent()
	});
}
export function createUpstreamHeaders(
	incoming: Headers,
	session: ServiceIdentity & { language: string; country: string },
	targetUrl: URL,
	cookieJar: Pick<CookieJar, 'getCookieHeader' | 'getCookies'>,
	token: string,
	method = 'GET'
): Headers {
	const headers = new Headers();
	const incomingOrigin = incoming.get('origin');
	const incomingReferer = incoming.get('referer');
	for (const [name, value] of incoming) {
		if (
			[
				'host',
				'connection',
				'keep-alive',
				'transfer-encoding',
				'upgrade',
				'content-length',
				'cookie',
				'accept-encoding',
				'origin',
				'referer',
				'cf-connecting-ip',
				'x-forwarded-for',
				'x-forwarded-host',
				'x-forwarded-proto',
				'x-nso-internal-session-auth'
			].includes(name.toLowerCase())
		) {
			continue;
		}
		headers.set(name, value);
	}

	const isStatic = isStaticServiceAsset(targetUrl);
	const cookies = cookieJar.getCookieHeader(targetUrl);
	if (cookies) headers.set('cookie', cookies);

	const cookieEntries = cookieJar.getCookies();
	const isNook = isNookLink(session);
	const isSmash = isSmashWorld(session);
	const isZelda = isZeldaNotes(session);
	const hasGToken = cookieEntries.some((cookie) => cookie.name === '_gtoken');
	const hasSmashSession = cookieEntries.some((cookie) =>
		/(?:super_smash_session|session)/i.test(cookie.name)
	);
	const hasZeldaSession = cookieEntries.some((cookie) => /(?:a5_token|session)/i.test(cookie.name));
	const initialNookDocument =
		isNook &&
		method === 'GET' &&
		!hasGToken &&
		targetUrl.origin === new URL(session.serviceUri).origin &&
		!targetUrl.pathname.startsWith('/api/');
	const initialSmashDocument =
		isSmash &&
		method === 'GET' &&
		!hasSmashSession &&
		targetUrl.origin === new URL(session.serviceUri).origin &&
		targetUrl.pathname === '/';
	const clientGameToken = incoming.get('x-gamewebtoken');

	let attachGameToken: boolean;
	if (session.serviceId === SPLATNET3_ID) {
		attachGameToken =
			targetUrl.pathname === '/api/bullet_tokens' || targetUrl.pathname === '/api/primer_tokens';
	} else if (isNook) {
		attachGameToken = initialNookDocument;
	} else if (isZelda) {
		attachGameToken = !hasZeldaSession && !isStatic;
	} else if (isSmash) {
		attachGameToken = !hasSmashSession && !isStatic;
	} else {
		attachGameToken = !isStatic;
	}

	if (clientGameToken) {
		headers.set('x-gamewebtoken', clientGameToken);
	} else if (attachGameToken) {
		headers.set('x-gamewebtoken', token);
	} else {
		headers.delete('x-gamewebtoken');
	}

	headers.set(
		'user-agent',
		isNook || isSmash
			? IOS_UA
			: isSplatNet2(session) && incoming.has('user-agent')
				? incoming.get('user-agent')!
				: androidUserAgent()
	);
	if (isNook || isSmash) {
		for (const name of [
			'sec-ch-ua',
			'sec-ch-ua-mobile',
			'sec-ch-ua-platform',
			'sec-ch-ua-platform-version',
			'sec-ch-ua-arch',
			'sec-ch-ua-bitness',
			'sec-ch-ua-full-version',
			'sec-ch-ua-full-version-list',
			'sec-ch-ua-model',
			'sec-ch-ua-wow64'
		]) {
			headers.delete(name);
		}
	}
	if (isNook) {
		headers.delete('if-none-match');
		headers.delete('if-modified-since');
	}
	if (!isStatic) {
		if (!headers.has('x-appplatform')) headers.set('x-appplatform', 'android');
		if (!headers.has('x-appcolorscheme')) headers.set('x-appcolorscheme', 'DARK');
		if (!headers.has('x-requested-with')) headers.set('x-requested-with', 'com.nintendo.znca');
		if (!headers.has('x-nacountry')) headers.set('x-nacountry', session.country);
		if (!headers.has('accept-language')) headers.set('accept-language', session.language);
	}
	const serviceOrigin = new URL(session.serviceUri).origin;
	if (isNook || isSmash) {
		if (incomingOrigin) headers.set('origin', serviceOrigin);
		else headers.delete('origin');
		if (incomingReferer) headers.set('referer', `${serviceOrigin}/`);
		else headers.delete('referer');
	} else {
		headers.set('origin', targetUrl.origin);
		headers.set('referer', `${targetUrl.origin}/`);
	}
	if (initialNookDocument && !clientGameToken) {
		headers.delete('cookie');
		headers.set('dnt', '0');
		headers.set('x-isappanalyticsoptedin', 'false');
	}
	if (initialSmashDocument) {
		headers.delete('origin');
		headers.delete('referer');
		if (!clientGameToken) {
			headers.set('upgrade-insecure-requests', '1');
			headers.set('x-appplatform', 'android');
			headers.set('x-appcolorscheme', 'DARK');
			headers.set('x-requested-with', 'com.nintendo.znca');
			headers.set('dnt', '1');
			headers.set(
				'accept',
				'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8'
			);
			headers.set('accept-language', session.language);
			for (const name of [
				'sec-fetch-dest',
				'sec-fetch-mode',
				'sec-fetch-site',
				'sec-fetch-user',
				'priority'
			])
				headers.delete(name);
		}
	}
	return headers;
}
