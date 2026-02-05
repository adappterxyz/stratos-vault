import { getSpliceClientForUser, jsonResponse, errorResponse, handleCors, requireAuth, Env } from '../../_lib/utils';
import { getWalletAddresses } from '../../_lib/wallet-generator';

export async function onRequestGet(context: { request: Request; env: Env }) {
  const corsResponse = handleCors(context.request);
  if (corsResponse) return corsResponse;

  try {
    const authResult = await requireAuth(context.request, context.env.DB);
    if (authResult instanceof Response) return authResult;
    const { user } = authResult;

    const spliceClient = getSpliceClientForUser(context.env, user.username);
    const userStatus = await spliceClient.getUserStatus();

    // Get wallet addresses for all chains
    const walletAddresses = await getWalletAddresses(context.env.DB, user.id);

    // Check for config overrides from database
    let theme = context.env.THEME || 'purple';
    let orgName = context.env.ORG_NAME || 'Canton Wallet';
    try {
      const overrides = await context.env.DB.prepare(
        `SELECT key, value FROM config_overrides WHERE key IN ('THEME', 'ORG_NAME')`
      ).all();
      for (const row of overrides.results as unknown as { key: string; value: string }[]) {
        if (row.key === 'THEME') theme = row.value;
        if (row.key === 'ORG_NAME') orgName = row.value;
      }
    } catch {
      // Table might not exist, use env defaults
    }

    return jsonResponse({
      success: true,
      data: {
        partyId: userStatus.party_id,
        cantonHost: context.env.SPLICE_HOST,
        cantonPort: context.env.SPLICE_PORT,
        applicationId: context.env.CANTON_AUTH_USER,
        onboarded: userStatus.user_onboarded,
        walletInstalled: userStatus.user_wallet_installed,
        theme,
        orgName,
        walletAddresses: walletAddresses
      }
    });
  } catch (error) {
    console.error('Error getting wallet info:', error);
    return errorResponse('Failed to get wallet info');
  }
}

export async function onRequestOptions(context: { request: Request }) {
  return handleCors(context.request);
}
