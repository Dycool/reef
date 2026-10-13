import type { WebviewCookie } from './db/schema';

export class CookieJar {
	private cookies: WebviewCookie[];

	constructor(cookies: WebviewCookie[]) {
		this.cookies = [...cookies];
	}

	getCookies() {
		this.removeExpired();
		return [...this.cookies];
	}

	toJSON() {
		this.removeExpired();
		return this.cookies;
	}

	getCookieHeader(target: URL): string {
		this.removeExpired();
		return this.cookies
			.filter((cookie) => {
				if (cookie.secure && target.protocol !== 'https:') return false;
				if (cookie.hostOnly) {
					if (cookie.domain !== target.hostname) return false;
				} else if (
					target.hostname !== cookie.domain &&
					!target.hostname.endsWith(`.${cookie.domain}`)
				) {
					return false;
				}
				return cookie.path === '/' || target.pathname.startsWith(cookie.path);
			})
			.sort((a, b) => b.path.length - a.path.length)
			.map((cookie) => `${cookie.name}=${cookie.value}`)
			.join('; ');
	}

	addSetCookie(raw: string, currentUrl: URL) {
		const parts = raw.split(';').map((part) => part.trim());
		const separator = parts[0]?.indexOf('=') ?? -1;
		if (separator <= 0) return;
		const name = parts[0].slice(0, separator);
		const value = parts[0].slice(separator + 1);
		let domain = currentUrl.hostname.toLowerCase();
		let hostOnly = true;
		let path = currentUrl.pathname.slice(0, currentUrl.pathname.lastIndexOf('/') + 1) || '/';
		let secure = false;
		let httpOnly = false;
		let expires: number | undefined;

		for (const part of parts.slice(1)) {
			const [rawName, ...rawValue] = part.split('=');
			const attribute = rawName.toLowerCase();
			const attributeValue = rawValue.join('=');
			if (attribute === 'domain' && attributeValue) {
				const candidate = attributeValue.replace(/^\./, '').toLowerCase();
				if (currentUrl.hostname === candidate || currentUrl.hostname.endsWith(`.${candidate}`)) {
					domain = candidate;
					hostOnly = false;
				}
			} else if (attribute === 'path' && attributeValue) path = attributeValue;
			else if (attribute === 'secure') secure = true;
			else if (attribute === 'httponly') httpOnly = true;
			else if (attribute === 'max-age') expires = Date.now() + Number(attributeValue) * 1000;
			else if (attribute === 'expires' && expires === undefined)
				expires = Date.parse(attributeValue);
		}

		this.cookies = this.cookies.filter(
			(cookie) => !(cookie.name === name && cookie.domain === domain && cookie.path === path)
		);
		if (!expires || expires > Date.now()) {
			this.cookies.push({ name, value, domain, path, hostOnly, secure, httpOnly, expires });
		}
	}

	private removeExpired() {
		const now = Date.now();
		this.cookies = this.cookies.filter((cookie) => !cookie.expires || cookie.expires > now);
	}
}
