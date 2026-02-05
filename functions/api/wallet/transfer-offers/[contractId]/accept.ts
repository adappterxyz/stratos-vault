import { getSpliceClientForUser, jsonResponse, errorResponse, handleCors, requireAuth, recordTransaction, Env } from '../../../../_lib/utils';

export async function onRequestPost(context: { request: Request; env: Env; params: { contractId: string } }) {
  const corsResponse = handleCors(context.request);
  if (corsResponse) return corsResponse;

  try {
    const authResult = await requireAuth(context.request, context.env.DB);
    if (authResult instanceof Response) return authResult;
    const { user } = authResult;

    const { contractId } = context.params;
    const spliceClient = getSpliceClientForUser(context.env, user.username);

    // Get offer details before accepting (for recording transaction)
    let offerAmount: string | undefined;
    let senderParty: string | undefined;
    try {
      const offers = await spliceClient.listTransferOffers();
      const offer = offers.find((o: any) => o.contract_id === contractId);
      if (offer) {
        // Offer structure: { contract_id, payload: { amount: { amount, unit }, sender, receiver, ... } }
        offerAmount = offer.payload?.amount?.amount || offer.amount;
        senderParty = offer.payload?.sender || offer.sender_party_id || offer.sender;
      }
    } catch (e) {
      console.warn('Could not get offer details:', e);
    }

    const result = await spliceClient.acceptTransferOffer(contractId);

    // Record the receive transaction
    try {
      await recordTransaction(context.env.DB, {
        userId: user.id,
        txHash: contractId,
        txType: 'receive',
        status: 'confirmed',
        assetSymbol: 'CC',
        chain: 'Canton',
        chainType: 'canton',
        amount: offerAmount || '0',
        fromAddress: senderParty || 'unknown',
        toAddress: user.partyId || user.username,
        description: 'Accepted transfer offer',
        metadata: {
          contractId,
          acceptResult: result
        }
      });

      // Update sender's pending transaction to confirmed (if they're also a user in this system)
      await context.env.DB.prepare(
        `UPDATE transactions SET status = 'confirmed', updated_at = datetime('now')
         WHERE tx_hash = ? AND tx_type = 'send' AND status = 'pending'`
      ).bind(contractId).run();
    } catch (txError) {
      console.error('Failed to record receive transaction:', txError);
      // Don't fail the acceptance if recording fails
    }

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
