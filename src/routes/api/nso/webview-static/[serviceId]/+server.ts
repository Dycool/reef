import type { RequestHandler } from './$types';
import { serveStableGameAsset } from '$lib/server/game-webview';

export const GET: RequestHandler = async ({ locals, cookies, request }) => {
	const activeSession = cookies.get('reef_game_webview');
	if (!locals.nintendoAccount || !activeSession) {
		return new Response('Game-service session authentication required.', { status: 401 });
	}
	return (
		(await serveStableGameAsset(request, locals.nintendoAccount.id, activeSession)) ||
		new Response('Invalid Nintendo static resource.', { status: 400 })
	);
};
