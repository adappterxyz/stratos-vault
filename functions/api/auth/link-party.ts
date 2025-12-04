import { jsonResponse, errorResponse, handleCors, Env } from '../../_lib/utils';

export async function onRequestPost(context: { request: Request; env: Env }) {
  const corsResponse = handleCors(context.request);
  if (corsResponse) return corsResponse;

  try {
    const sessionId = context.request.headers.get('Authorization')?.replace('Bearer ', '');

    if (!sessionId) {
      return errorResponse('Unauthorized', 401);
    }

    const session = await context.env.DB.prepare(
      'SELECT user_id FROM sessions WHERE id = ? AND expires_at > datetime("now")'
    ).bind(sessionId).first();

    if (!session) {
      return errorResponse('Invalid session', 401);
    }

    const { partyId } = await context.request.json() as { partyId: string };

    if (!partyId) {
      return errorResponse('partyId is required', 400);
    }

    // Update user with party ID
    await context.env.DB.prepare(
      'UPDATE users SET party_id = ?, updated_at = datetime("now") WHERE id = ?'
    ).bind(partyId, session.user_id).run();

    return jsonResponse({
      success: true,
      data: { partyId }
    });
  } catch (error) {
    console.error('Error linking party:', error);
    return errorResponse('Failed to link party');
  }
}

export async function onRequestOptions(context: { request: Request }) {
  return handleCors(context.request);
}
