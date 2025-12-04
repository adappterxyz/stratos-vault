import { jsonResponse, errorResponse, handleCors, Env } from '../../_lib/utils';

export async function onRequestGet(context: { request: Request; env: Env }) {
  const corsResponse = handleCors(context.request);
  if (corsResponse) return corsResponse;

  try {
    const sessionId = context.request.headers.get('Authorization')?.replace('Bearer ', '');

    if (!sessionId) {
      return errorResponse('No session', 401);
    }

    const session = await context.env.DB.prepare(
      `SELECT s.*, u.username, u.display_name, u.party_id, u.role
       FROM sessions s
       JOIN users u ON s.user_id = u.id
       WHERE s.id = ? AND s.expires_at > datetime("now")`
    ).bind(sessionId).first();

    if (!session) {
      return errorResponse('Invalid or expired session', 401);
    }

    return jsonResponse({
      success: true,
      data: {
        user: {
          id: session.user_id,
          username: session.username,
          displayName: session.display_name,
          partyId: session.party_id,
          role: session.role || 'user'
        }
      }
    });
  } catch (error) {
    console.error('Error checking session:', error);
    return errorResponse('Failed to check session');
  }
}

export async function onRequestDelete(context: { request: Request; env: Env }) {
  const corsResponse = handleCors(context.request);
  if (corsResponse) return corsResponse;

  try {
    const sessionId = context.request.headers.get('Authorization')?.replace('Bearer ', '');

    if (sessionId) {
      await context.env.DB.prepare('DELETE FROM sessions WHERE id = ?').bind(sessionId).run();
    }

    return jsonResponse({ success: true });
  } catch (error) {
    console.error('Error deleting session:', error);
    return errorResponse('Failed to logout');
  }
}

export async function onRequestOptions(context: { request: Request }) {
  return handleCors(context.request);
}
