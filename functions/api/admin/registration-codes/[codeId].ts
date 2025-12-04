import { jsonResponse, errorResponse, handleCors, requireAdmin, Env } from '../../../_lib/utils';

// Delete a registration code
export async function onRequestDelete(context: { request: Request; env: Env; params: { codeId: string } }) {
  const corsResponse = handleCors(context.request);
  if (corsResponse) return corsResponse;

  try {
    const authResult = await requireAdmin(context.request, context.env.DB);
    if (authResult instanceof Response) return authResult;

    const { codeId } = context.params;

    const result = await context.env.DB.prepare(
      'DELETE FROM registration_codes WHERE id = ?'
    ).bind(codeId).run();

    if (result.meta.changes === 0) {
      return errorResponse('Registration code not found', 404);
    }

    return jsonResponse({
      success: true,
      message: 'Registration code deleted'
    });
  } catch (error) {
    console.error('Error deleting registration code:', error);
    return errorResponse('Failed to delete registration code');
  }
}

export async function onRequestOptions(context: { request: Request }) {
  return handleCors(context.request);
}
