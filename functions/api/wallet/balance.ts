import { getSpliceClientForUser, jsonResponse, handleCors, requireAuth, Env } from '../../_lib/utils';

export async function onRequestGet(context: { request: Request; env: Env }) {
  const corsResponse = handleCors(context.request);
  if (corsResponse) return corsResponse;

  try {
    const authResult = await requireAuth(context.request, context.env.DB);
    if (authResult instanceof Response) return authResult;
    const { user } = authResult;

    const spliceClient = getSpliceClientForUser(context.env, user.username);

    const userStatus = await spliceClient.getUserStatus();

    if (!userStatus.user_wallet_installed) {
      return jsonResponse({
        success: true,
        data: {
          total: 0,
          contracts: 0
        }
      });
    }

    const balance = await spliceClient.getBalance();

    return jsonResponse({
      success: true,
      data: {
        total: parseFloat(balance.effective_unlocked_qty),
        contracts: 1
      }
    });
  } catch (error) {
    console.error('Error getting balance:', error);
    return jsonResponse({
      success: true,
      data: {
        total: 0,
        contracts: 0
      }
    });
  }
}

export async function onRequestOptions(context: { request: Request }) {
  return handleCors(context.request);
}
