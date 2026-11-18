import { describe, expect, it } from 'vitest';
import { rewriteHlsPlaylist } from './rewrite-hls-playlist';

const session = 'test-session';
const origin = new URL('https://api.lp1.87abc152.srv.nintendo.net/static/v1/oot/movie/master.m3u8');
const allowed = (url: URL) => url.origin === origin.origin;
const proxy = (url: string) =>
	`/api/nso/webview/${session}/proxy?url=${encodeURIComponent(url)}`;

describe('Zelda Notes HLS playlist rewriting', () => {
	it('resolves each relative variant against its Nintendo master manifest', () => {
		const manifest = [
			'#EXTM3U',
			'#EXT-X-STREAM-INF:BANDWIDTH=1500000,RESOLUTION=854x480',
			'480p/playlist.m3u8',
			'#EXT-X-STREAM-INF:BANDWIDTH=3000000,RESOLUTION=1280x720',
			'720p/playlist.m3u8',
			'#EXT-X-STREAM-INF:BANDWIDTH=6000000,RESOLUTION=1920x1080',
			'1080p/playlist.m3u8',
			''
		].join('\n');
		const rewritten = rewriteHlsPlaylist(manifest, origin, session, allowed);
		for (const resolution of ['480p', '720p', '1080p']) {
			expect(rewritten).toContain(proxy(new URL(`${resolution}/playlist.m3u8`, origin).toString()));
		}
		expect(rewritten).not.toContain('\n720p/playlist.m3u8\n');
		expect(rewritten).toContain('#EXT-X-STREAM-INF:BANDWIDTH=3000000,RESOLUTION=1280x720');
	});

	it('rewrites nested media segments, initialization maps, keys and parts', () => {
		const variant = new URL('720p/playlist.m3u8', origin);
		const playlist = [
			'#EXTM3U',
			'#EXT-X-KEY:METHOD=AES-128,URI="../key.bin"',
			'#EXT-X-MAP:URI="init.mp4"',
			'#EXT-X-PART:DURATION=0.2,URI="part000.m4s"',
			'#EXTINF:4,',
			'segment-001.ts?sig=a%2Fb',
			''
		].join('\r\n');
		const rewritten = rewriteHlsPlaylist(playlist, variant, session, allowed);
		for (const uri of ['../key.bin', 'init.mp4', 'part000.m4s', 'segment-001.ts?sig=a%2Fb']) {
			expect(rewritten).toContain(proxy(new URL(uri, variant).toString()));
		}
		expect(rewritten).toContain('\r\n#EXTINF:4,\r\n');
		expect(rewritten).not.toContain('\n#EXTINF:4,\n');
	});

	it('does not proxy disallowed origins or non-HTTP media schemes', () => {
		const playlist = '#EXTM3U\n#EXT-X-KEY:METHOD=SAMPLE-AES,URI="skd://key"\nhttps://example.org/video.ts\n';
		expect(rewriteHlsPlaylist(playlist, origin, session, allowed)).toBe(playlist);
	});

	it('handles allowed absolute media URLs and leaves comments untouched', () => {
		const uri = 'https://api.lp1.87abc152.srv.nintendo.net/video/seg.ts?token=abc';
		const source = `#EXTM3U\n# An ordinary comment with URI="ignored.ts"\n${uri}\n`;
		const rewritten = rewriteHlsPlaylist(source, origin, session, allowed);
		expect(rewritten).toContain(proxy(uri));
		expect(rewritten).toContain('# An ordinary comment with URI="ignored.ts"');
	});
});
