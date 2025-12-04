import { getSpliceClientForUser, jsonResponse, errorResponse, handleCors, requireAuth, validateAdminToken, Env } from '../../_lib/utils';

export async function onRequestPost(context: { request: Request; env: Env }) {
  const corsResponse = handleCors(context.request);
  if (corsResponse) return corsResponse;

  try {
    // Check for admin token - allows admin to tap faucet for any user
    const adminToken = context.request.headers.get('X-Admin-Token');
    const walletUser = context.request.headers.get('X-Wallet-User');

    let username: string;

    if (adminToken && walletUser) {
      // Admin tapping faucet for a specific user
      const isValidAdmin = await validateAdminToken(context.env.DB, adminToken);
      if (!isValidAdmin) {
        return errorResponse('Invalid admin token', 401);
      }
      username = walletUser;
    } else {
      // Regular user tapping their own faucet
      const authResult = await requireAuth(context.request, context.env.DB);
      if (authResult instanceof Response) return authResult;
      username = authResult.user.username;
    }

    const { amount } = await context.request.json() as { amount?: string };
    const requestedAmount = parseFloat(amount || '100.0');
    const tapAmount = (requestedAmount / 200).toFixed(10);

    const spliceClient = getSpliceClientForUser(context.env, username);
    const result = await spliceClient.tap(tapAmount);

    return jsonResponse({
      success: true,
      data: result
    });
  } catch (error) {
    console.error('Error tapping faucet:', error);
    return errorResponse(error instanceof Error ? error.message : 'Failed to tap faucet');
  }
}

export async function onRequestOptions(context: { request: Request }) {
  return handleCors(context.request);
}
