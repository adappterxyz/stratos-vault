import { getSpliceClientForUser, jsonResponse, handleCors, requireAuth, Env } from '../../_lib/utils';

export async function onRequestGet(context: { request: Request; env: Env }) {
  const corsResponse = handleCors(context.request);
  if (corsResponse) return corsResponse;

  try {
    const authResult = await requireAuth(context.request, context.env.DB);
    if (authResult instanceof Response) return authResult;
    const { user } = authResult;

    const url = new URL(context.request.url);
    const limit = parseInt(url.searchParams.get('limit') || '50');
    const spliceClient = getSpliceClientForUser(context.env, user.username);

    const userStatus = await spliceClient.getUserStatus();

    if (!userStatus.user_wallet_installed) {
      return jsonResponse({
        success: true,
        data: []
      });
    }

    const txResponse = await spliceClient.getTransactions(limit);
    const myPartyId = userStatus.party_id;

    const transactions = txResponse.items
      .filter(tx => tx.sender && tx.sender.party)
      .map(tx => {
        const isSender = tx.sender.party === myPartyId;
        const amount = parseFloat(tx.sender.amount);

        return {
          transactionId: tx.event_id,
          timestamp: tx.date,
          type: isSender ? 'send' : 'receive',
          amount: amount,
          from: tx.sender.party,
          to: tx.receivers.length > 0 ? tx.receivers[0].party : myPartyId
        };
      });

    return jsonResponse({
      success: true,
      data: transactions
    });
  } catch (error) {
    console.error('Error getting transactions:', error);
    return jsonResponse({
      success: true,
      data: []
    });
  }
}

export async function onRequestOptions(context: { request: Request }) {
  return handleCors(context.request);
}
