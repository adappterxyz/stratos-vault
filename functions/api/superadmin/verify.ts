import { jsonResponse, errorResponse, handleCors, Env, validateSuperadminSession } from '../../_lib/utils';

export async function onRequestGet(context: { request: Request; env: Env }) {
  const corsResponse = handleCors(context.request);
  if (corsResponse) return corsResponse;

  try {
    const token = context.request.headers.get('X-Superadmin-Token');
    const user = await validateSuperadminSession(context.env.DB, token);

    if (!user) {
      return errorResponse('Invalid or expired session', 401);
    }

    return jsonResponse({
      success: true,
      data: {
        user: {
          id: user.id,
          username: user.username,
          displayName: user.displayName,
          isSuperadmin: user.isSuperadmin
        }
      }
    });
  } catch (error) {
    console.error('Session verify error:', error);
    return errorResponse('Verification failed');
  }
}

export async function onRequestOptions(context: { request: Request }) {
  return handleCors(context.request);
}
