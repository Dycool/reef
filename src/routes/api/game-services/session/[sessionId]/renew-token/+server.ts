import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getGameWebServiceToken } from '$lib/server/coral';
import { getGameWebviewSession } from '$lib/server/game-webview';
import { db } from '$lib/server/db';
import { gameWebviewSessions } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import { isNookLink, isSmashWorld, isSplatNet2 } from '$lib/server/game-service-compat';

export const POST: RequestHandler = async ({ locals, params, request, url, cookies }) => {
	if (!locals.nintendoAccount) throw error(401, 'Authentication required');
	const origin = request.headers.get('origin');
	if (origin && origin !== url.origin) throw error(403, 'Cross-origin request denied');

	const session = await getGameWebviewSession(locals.nintendoAccount.id, params.sessionId);
	if (!session) throw error(404, 'Game-service session not found');

	const token = await getGameWebServiceToken(locals.nintendoAccount, session.serviceId, true);
	if (isNookLink(session) || isSmashWorld(session) || isSplatNet2(session)) {
		await db
			.update(gameWebviewSessions)
			.set({ expiresAt: new Date(Date.now() + 7200_000) })
			.where(eq(gameWebviewSessions.id, session.id));
		cookies.set('reef_game_webview', session.id, {
			path: '/',
			httpOnly: true,
			sameSite: 'lax',
			secure: !['localhost', '127.0.0.1'].includes(url.hostname),
			maxAge: 7200
		});
	}
	return json(
		{ token: token.token, expiresAt: token.expiresAt },
		{ headers: { 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer' } }
	);
};
