import { jsonResponse, errorResponse, handleCors, Env } from '../../_lib/utils';

export async function onRequestPost(context: { request: Request; env: Env }) {
  const corsResponse = handleCors(context.request);
  if (corsResponse) return corsResponse;

  try {
    const token = context.request.headers.get('X-Superadmin-Token');

    if (!token) {
      return errorResponse('No session token provided', 400);
    }

    // Delete the session
    await context.env.DB.prepare(
      `DELETE FROM superadmin_sessions WHERE id = ?`
    ).bind(token).run();

    return jsonResponse({
      success: true,
      message: 'Logged out successfully'
    });
  } catch (error) {
    console.error('Superadmin logout error:', error);
    return errorResponse('Logout failed');
  }
}

export async function onRequestOptions(context: { request: Request }) {
  return handleCors(context.request);
}
