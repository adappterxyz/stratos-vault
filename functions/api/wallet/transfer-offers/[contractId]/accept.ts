import { getSpliceClientForUser, jsonResponse, errorResponse, handleCors, requireAuth, Env } from '../../../../_lib/utils';

export async function onRequestPost(context: { request: Request; env: Env; params: { contractId: string } }) {
  const corsResponse = handleCors(context.request);
  if (corsResponse) return corsResponse;

  try {
    const authResult = await requireAuth(context.request, context.env.DB);
    if (authResult instanceof Response) return authResult;
    const { user } = authResult;

    const { contractId } = context.params;
    const spliceClient = getSpliceClientForUser(context.env, user.username);

    const result = await spliceClient.acceptTransferOffer(contractId);

    return jsonResponse({
      success: true,
      data: result
    });
  } catch (error) {
    console.error('Error accepting transfer offer:', error);
    return errorResponse(error instanceof Error ? error.message : 'Failed to accept transfer offer');
  }
}

export async function onRequestOptions(context: { request: Request }) {
  return handleCors(context.request);
}
