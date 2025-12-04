import { getSpliceClientForUser, jsonResponse, errorResponse, handleCors, Env } from '../../_lib/utils';

export async function onRequestPost(context: { request: Request; env: Env }) {
  const corsResponse = handleCors(context.request);
  if (corsResponse) return corsResponse;

  try {
    const { username } = await context.request.json() as { username: string };

    if (!username) {
      return errorResponse('Missing required field: username', 400);
    }

    const spliceClient = getSpliceClientForUser(context.env, username);

    const registerResult = await spliceClient.register();
    const userStatus = await spliceClient.getUserStatus();

    return jsonResponse({
      success: true,
      data: {
        username,
        partyId: registerResult.party_id,
        onboarded: userStatus.user_onboarded,
        walletInstalled: userStatus.user_wallet_installed
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    return errorResponse(error instanceof Error ? error.message : 'Failed to login');
  }
}

export async function onRequestOptions(context: { request: Request }) {
  return handleCors(context.request);
}
