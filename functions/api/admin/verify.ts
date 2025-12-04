import { jsonResponse, errorResponse, handleCors, Env } from '../../_lib/utils';

export async function onRequestGet(context: { request: Request; env: Env }) {
  const corsResponse = handleCors(context.request);
  if (corsResponse) return corsResponse;

  try {
    const token = context.request.headers.get('X-Admin-Token');

    if (!token) {
      return errorResponse('Admin token required', 401);
    }

    // Check if token exists and is not expired
    const session = await context.env.DB.prepare(
      `SELECT * FROM admin_sessions WHERE id = ? AND expires_at > datetime('now')`
    ).bind(token).first();

    if (!session) {
      return errorResponse('Invalid or expired token', 401);
    }

    return jsonResponse({
      success: true,
      data: { valid: true }
    });
  } catch (error) {
    console.error('Admin verify error:', error);
    return errorResponse('Verification failed');
  }
}

export async function onRequestOptions(context: { request: Request }) {
  return handleCors(context.request);
}
