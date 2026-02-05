import { getSpliceClientForUser, jsonResponse, errorResponse, handleCors, requireAuth, validateAdminToken, validateSuperadminSession, recordTransaction, Env } from '../../_lib/utils';

export async function onRequestPost(context: { request: Request; env: Env }) {
  const corsResponse = handleCors(context.request);
  if (corsResponse) return corsResponse;

  try {
    // Check for admin or superadmin token - allows admin to tap faucet for any user
    const adminToken = context.request.headers.get('X-Admin-Token');
    const superadminToken = context.request.headers.get('X-Superadmin-Token');
    const walletUser = context.request.headers.get('X-Wallet-User');

    let username: string;
    let userId: string | null = null;

    if ((adminToken || superadminToken) && walletUser) {
      // Admin or superadmin tapping faucet for a specific user
      let isValidAuth = false;

      if (adminToken) {
        isValidAuth = await validateAdminToken(context.env.DB, adminToken);
      } else if (superadminToken) {
        const superadminUser = await validateSuperadminSession(context.env.DB, superadminToken);
        isValidAuth = !!superadminUser;
      }

      if (!isValidAuth) {
        return errorResponse('Invalid admin token', 401);
      }
      username = walletUser;

      // Look up user ID for the wallet user
      const userRecord = await context.env.DB.prepare(
        `SELECT id FROM users WHERE username = ?`
      ).bind(walletUser).first<{ id: string }>();
      userId = userRecord?.id || null;
    } else {
      // Regular user tapping their own faucet
      const authResult = await requireAuth(context.request, context.env.DB);
      if (authResult instanceof Response) return authResult;
      username = authResult.user.username;
      userId = authResult.user.id;
    }

    const { amount } = await context.request.json() as { amount?: string };
    const requestedAmount = parseFloat(amount || '100.0');
    const tapAmount = (requestedAmount / 200).toFixed(10);

    const spliceClient = getSpliceClientForUser(context.env, username);
    const result = await spliceClient.tap(tapAmount);

    // Record the tap (faucet) transaction
    if (userId) {
      try {
        await recordTransaction(context.env.DB, {
          userId,
          txType: 'tap',
          status: 'confirmed',
          assetSymbol: 'CC',
          chain: 'Canton',
          chainType: 'canton',
          amount: requestedAmount.toString(),
          toAddress: username,
          description: 'Faucet tap',
          metadata: {
            tapAmount,
            result
          }
        });
      } catch (txError) {
        console.error('Failed to record tap transaction:', txError);
      }
    }

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
