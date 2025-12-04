import { getSpliceClientForUser, jsonResponse, errorResponse, handleCors, requireAuth, Env } from '../../_lib/utils';

export async function onRequestGet(context: { request: Request; env: Env }) {
  const corsResponse = handleCors(context.request);
  if (corsResponse) return corsResponse;

  try {
    const authResult = await requireAuth(context.request, context.env.DB);
    if (authResult instanceof Response) return authResult;
    const { user } = authResult;

    const spliceClient = getSpliceClientForUser(context.env, user.username);
    const offers = await spliceClient.listTransferOffers();

    return jsonResponse({
      success: true,
      data: offers
    });
  } catch (error) {
    console.error('Error listing transfer offers:', error);
    return errorResponse('Failed to list transfer offers');
  }
}

export async function onRequestOptions(context: { request: Request }) {
  return handleCors(context.request);
}
