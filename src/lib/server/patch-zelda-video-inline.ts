/**
 * Zelda Notes' Ocarina of Time video player explicitly invokes the Fullscreen
 * API on its play-button press, which is undesirable in a desktop iframe.
 * Let playback begin inline; keep native video controls (including the user's
 * fullscreen button) completely untouched.
 *
 * This exact, guarded match intentionally fails closed if Nintendo updates the
 * minified player. Never intercept the browser's Fullscreen API globally.
 */
const AUTO_FULLSCREEN_AFTER_PLAY =
    "e.play().catch(()=>{}),function(e){if(document.fullscreenEnabled)return e.requestFullscreen().catch(()=>{});if(void 0!==e.webkitEnterFullscreen)try{e.webkitEnterFullscreen()}catch(t){e.addEventListener(\"loadedmetadata\",()=>{if(!e.paused)try{var t;null==(t=e.webkitEnterFullscreen)||t.call(e)}catch(e){}},{once:!0})}}(e)";

export function patchZeldaNotesInlineVideo(jsText: string): string {
    if (!jsText.includes('OotTrajectoryOfTime.Play')) return jsText;
    return jsText.replace(AUTO_FULLSCREEN_AFTER_PLAY, 'e.play().catch(()=>{})');
}
