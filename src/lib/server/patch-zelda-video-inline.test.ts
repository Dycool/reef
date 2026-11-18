import { describe, expect, it } from 'vitest';
import { patchZeldaNotesInlineVideo } from './patch-zelda-video-inline';

const automaticFullscreen = "e.play().catch(()=>{}),function(e){if(document.fullscreenEnabled)return e.requestFullscreen().catch(()=>{});if(void 0!==e.webkitEnterFullscreen)try{e.webkitEnterFullscreen()}catch(t){e.addEventListener(\"loadedmetadata\",()=>{if(!e.paused)try{var t;null==(t=e.webkitEnterFullscreen)||t.call(e)}catch(e){}},{once:!0})}}(e)";
const player =
	'const player={playsInline:!0,controls:p,onPress:()=>{let e=y.current;null!==e&&(e.ended&&(e.currentTime=0),' +
	automaticFullscreen +
	')},label:"OotTrajectoryOfTime.Play"}';

describe('Zelda Notes Ocarina video inline playback', () => {
	it('starts playback without forcing fullscreen', () => {
		const patched = patchZeldaNotesInlineVideo(player);
		expect(patched).not.toBe(player);
		expect(patched).toContain('e.play().catch(()=>{})');
		expect(patched).toContain('playsInline:!0,controls:p');
		expect(patched).not.toContain('requestFullscreen()');
		expect(patched).not.toContain('webkitEnterFullscreen');
	});

	it('does not rewrite an unrelated player', () => {
		const unrelated = player.replace('OotTrajectoryOfTime.Play', 'DifferentVideo.Play');
		expect(patchZeldaNotesInlineVideo(unrelated)).toBe(unrelated);
	});

	it('leaves unknown future Nintendo code alone', () => {
		const updated = player.replace('e.play().catch(()=>{})', 'e.play({}).catch(()=>{})');
		expect(patchZeldaNotesInlineVideo(updated)).toBe(updated);
	});

	it('is idempotent', () => {
		const patched = patchZeldaNotesInlineVideo(player);
		expect(patchZeldaNotesInlineVideo(patched)).toBe(patched);
	});
});
