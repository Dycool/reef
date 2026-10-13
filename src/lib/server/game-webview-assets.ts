import { isStrictNintendoOrigin } from './webviewDomains';

const CACHE_VERSION = '20260817-v1';

function hashedAsset(target: URL): boolean {
	return /(?:^|[._-])[a-f0-9]{8,}(?:[._-]|$)/i.test(target.pathname.split('/').pop() || '');
}

function staticAsset(target: URL): boolean {
	return /\/(?:_next\/static|static|assets)\//i.test(target.pathname);
}

export function immutableGameAsset(target: URL): boolean {
	return staticAsset(target) || hashedAsset(target);
}

export function reusableGameAsset(target: URL): 'script' | 'image' | null {
	if (!isStrictNintendoOrigin(target)) return null;
	const path = target.pathname;
	if (/\.m?js$/i.test(path) || path.includes('/_next/static/chunks/')) {
		return staticAsset(target) ||
			hashedAsset(target) ||
			/(?:^|[._-])chunk(?:[._-]|$)/i.test(path.split('/').pop() || '')
			? 'script'
			: null;
	}
	return /\.(?:png|jpe?g|webp|gif|svg|ico|avif)$/i.test(path) &&
		(staticAsset(target) || hashedAsset(target) || target.hostname.includes('.cdn.nintendo.net'))
		? 'image'
		: null;
}

export function stableGameAssetUrl(target: URL, serviceId: string): string {
	return `/api/nso/webview-static/${encodeURIComponent(serviceId)}?v=${CACHE_VERSION}&url=${encodeURIComponent(target.toString())}`;
}

export function gameAssetCacheControl(target: URL, response: Response): string {
	if (response.status !== 200 || response.headers.has('set-cookie')) return 'no-store';
	const type = response.headers.get('content-type') || '';
	if (/text\/html|application\/xhtml\+xml/i.test(type)) return 'no-store';
	if (
		target.pathname.startsWith('/_next/static/') ||
		/[-.][a-f0-9]{8,}\.(?:js|mjs|css|woff2?|png|jpe?g|webp|avif|svg)$/i.test(target.pathname)
	)
		return 'private, max-age=604800, immutable';
	if (
		/^(?:image|font|audio|video)\//i.test(type) ||
		/\.(?:png|jpe?g|gif|webp|avif|svg|ico|woff2?|ttf|otf|eot|mp3|m4a|mp4|webm)$/i.test(
			target.pathname
		) ||
		/javascript|ecmascript|text\/css/i.test(type) ||
		/\.(?:js|mjs|css)$/i.test(target.pathname)
	)
		return 'private, max-age=86400';
	if (type.includes('application/json') && /\/locales\//.test(target.pathname))
		return 'private, max-age=3600';
	return 'no-store';
}
