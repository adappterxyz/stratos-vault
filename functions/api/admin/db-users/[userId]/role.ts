import { jsonResponse, errorResponse, handleCors, requireAdmin, Env } from '../../../../_lib/utils';

export async function onRequestPut(context: { request: Request; env: Env; params: { userId: string } }) {
  const corsResponse = handleCors(context.request);
  if (corsResponse) return corsResponse;

  try {
    const authResult = await requireAdmin(context.request, context.env.DB);
    if (authResult instanceof Response) return authResult;

    const { userId } = context.params;
    const { role } = await context.request.json() as { role: string };

    if (!role || !['user', 'admin'].includes(role)) {
      return errorResponse('Invalid role. Must be "user" or "admin"', 400);
    }

    const result = await context.env.DB.prepare(
      'UPDATE users SET role = ? WHERE id = ?'
    ).bind(role, userId).run();

    if (result.meta.changes === 0) {
      return errorResponse('User not found', 404);
    }

    return jsonResponse({
      success: true,
      data: { userId, role }
    });
  } catch (error) {
    console.error('Error updating user role:', error);
    return errorResponse('Failed to update user role');
  }
}

export async function onRequestOptions(context: { request: Request }) {
  return handleCors(context.request);
}
