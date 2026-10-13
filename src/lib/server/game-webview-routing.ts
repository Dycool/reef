import { NOOKLINK_API_ORIGIN } from './webviewDomains';

export const GAME_WEBVIEW_SESSION_QUERY = 'reef_webview';
const sessionQueries = [GAME_WEBVIEW_SESSION_QUERY, 'reef_nooklink'];

export function gameWebviewLaunchPath(
	initialUrl: URL,
	sessionId: string,
	query = GAME_WEBVIEW_SESSION_QUERY
): string {
	const launch = new URL(initialUrl);
	launch.searchParams.set(query, sessionId);
	return launch.pathname + launch.search + launch.hash;
}

export function rootGameWebviewSession(
	url: URL,
	headers: Headers,
	activeSession?: string
): string | null {
	if (!activeSession) return null;
	if (url.pathname.startsWith('/api/') && !/^\/api\/sd\/v1(?:\/|$)/.test(url.pathname)) return null;
	for (const key of sessionQueries) {
		if (url.searchParams.has(key))
			return url.searchParams.get(key) === activeSession ? activeSession : null;
	}
	const referer = headers.get('referer');
	if (referer) {
		try {
			const source = new URL(referer);
			if (source.origin !== url.origin) return null;
			for (const key of sessionQueries) {
				if (source.searchParams.has(key))
					return source.searchParams.get(key) === activeSession ? activeSession : null;
			}
			// Client-side game navigation can drop the launch query. Nintendo's
			// image/font namespaces still belong to the active game, not Reef.
			if (
				/^\/(?:images|fonts|static|css|js)\//.test(url.pathname) &&
				['image', 'font', 'style', 'script', 'audio', 'video'].includes(
					headers.get('sec-fetch-dest') || ''
				)
			)
				return activeSession;
		} catch {
			/* Invalid referrers cannot select a game session. */
		}
	}
	if (headers.get('sec-fetch-dest') === 'iframe') return activeSession;
	return null;
}

export function rootGameWebviewProxyUrl(url: URL, serviceUri: string, sessionId: string): URL {
	const query = new URLSearchParams(url.search);
	for (const key of sessionQueries) query.delete(key);
	const base = /^\/api\/sd\/v1(?:\/|$)/.test(url.pathname) ? NOOKLINK_API_ORIGIN : serviceUri;
	const target = new URL(url.pathname + (query.size ? '?' + query.toString() : ''), base);
	const proxy = new URL(`/api/nso/webview/${sessionId}/proxy`, url.origin);
	proxy.searchParams.set('url', target.toString());
	return proxy;
}
