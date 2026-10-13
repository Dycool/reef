import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { closeGameWebviewSession } from '$lib/server/game-webview';

export const DELETE: RequestHandler = async ({ locals, params, request, url, cookies }) => {
	if (!locals.nintendoAccount) throw error(401, 'Authentication required');
	const origin = request.headers.get('origin');
	if (origin && origin !== url.origin) throw error(403, 'Cross-origin request denied');

	await closeGameWebviewSession(locals.nintendoAccount.id, params.sessionId);
	if (cookies.get('reef_game_webview') === params.sessionId)
		cookies.delete('reef_game_webview', { path: '/' });
	return json({ success: true }, { headers: { 'Cache-Control': 'private, no-store' } });
};
