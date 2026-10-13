export const TRUSTED_NINTENDO_DOMAINS = [
	'srv.nintendo.net',
	'nintendo.net',
	'nintendo.com',
	'nintendo.co.jp',
	'nintendowifi.net',
	'nintendo-europe.com'
];

export const NOOKLINK_API_ORIGIN = 'https://web.sd.lp1.acbaa.srv.nintendo.net';
export const NOOKLINK_DPL_ORIGIN = 'https://dpl.sd.lp1.acbaa.srv.nintendo.net';
export const SPLATNET3_API_ORIGIN = 'https://api.lp1.usagi.srv.nintendo.net';
export const SMASH_WORLD_CDN_ORIGIN = 'https://www-aaaba-lp1-hac.cdn.nintendo.net';

export const JSQR_CDN_URL = 'https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js';

export function isStrictNintendoOrigin(value: string | URL): boolean {
	try {
		const url = value instanceof URL ? value : new URL(value);
		return (
			url.protocol === 'https:' &&
			TRUSTED_NINTENDO_DOMAINS.some(
				(domain) => url.hostname === domain || url.hostname.endsWith(`.${domain}`)
			)
		);
	} catch {
		return false;
	}
}

export function isOriginWhitelisted(origin: string, allowedOrigins: string[]): boolean {
	if (!isStrictNintendoOrigin(origin)) return false;
	if (allowedOrigins.includes(origin)) return true;
	const host = new URL(origin).hostname;
	return allowedOrigins.some((allowed) => {
		const suffix = allowed
			.replace(/^https?:\/\//i, '')
			.replace(/^\*?\./, '')
			.split('/')[0];
		return (
			/^(?:https?:\/\/)?(?:\*\.|\.)/.test(allowed) &&
			(host === suffix || host.endsWith(`.${suffix}`))
		);
	});
}
