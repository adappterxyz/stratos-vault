import { jsonResponse, errorResponse, handleCors, requireAdmin, Env } from '../../../_lib/utils';

export async function onRequestDelete(context: { request: Request; env: Env; params: { userId: string } }) {
  const corsResponse = handleCors(context.request);
  if (corsResponse) return corsResponse;

  try {
    const authResult = await requireAdmin(context.request, context.env.DB);
    if (authResult instanceof Response) return authResult;

    const { userId } = context.params;

    // Delete associated sessions first
    await context.env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(userId).run();

    // Delete associated passkeys
    await context.env.DB.prepare('DELETE FROM passkeys WHERE user_id = ?').bind(userId).run();

    // Delete the user
    const result = await context.env.DB.prepare('DELETE FROM users WHERE id = ?').bind(userId).run();

    if (result.meta.changes === 0) {
      return errorResponse('User not found', 404);
    }

    return jsonResponse({
      success: true,
      data: { userId }
    });
  } catch (error) {
    console.error('Error deleting user:', error);
    return errorResponse('Failed to delete user');
  }
}

export async function onRequestOptions(context: { request: Request }) {
  return handleCors(context.request);
}
