/**
 * Resolve HLS playlist URIs against the Nintendo manifest URL rather than the
 * browser-visible /proxy?url= route. This keeps child manifests, media segments,
 * init maps, subtitles and keys inside the authenticated game-service proxy.
 */
export function rewriteHlsPlaylist(
	playlist: string,
	upstreamPlaylistUrl: URL,
	sessionId: string,
	isAllowedTarget: (target: URL) => boolean
): string {
	const proxyPrefix = `/api/nso/webview/${encodeURIComponent(sessionId)}/proxy?url=`;

	function proxyUri(uri: string): string {
		try {
			const target = new URL(uri, upstreamPlaylistUrl);
			if (target.protocol !== 'https:' || !isAllowedTarget(target)) return uri;
			return proxyPrefix + encodeURIComponent(target.toString());
		} catch {
			return uri;
		}
	}

	// Preserve whitespace and CRLF while handling both media URI lines and
	// quoted URI= attributes inside HLS directive lines.
	return playlist
		.split(/(\r?\n)/)
		.map((part, index) => {
			if (index % 2 !== 0) return part;
			const line = part.trim();
			if (!line) return part;
			if (line.startsWith('#')) {
				if (!line.startsWith('#EXT')) return part;
				return part.replace(/(\bURI=")([^"]+)(")/g, (_match, prefix, uri, suffix) => {
					return prefix + proxyUri(uri) + suffix;
				});
			}
			const leading = part.match(/^\s*/)?.[0] || '';
			const trailing = part.match(/\s*$/)?.[0] || '';
			return leading + proxyUri(line) + trailing;
		})
		.join('');
}
