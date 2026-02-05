import { getSpliceClientForUser, jsonResponse, errorResponse, handleCors, requireAuth, recordTransaction, Env } from '../../_lib/utils';

export async function onRequestPost(context: { request: Request; env: Env }) {
  const corsResponse = handleCors(context.request);
  if (corsResponse) return corsResponse;

  try {
    const authResult = await requireAuth(context.request, context.env.DB);
    if (authResult instanceof Response) return authResult;
    const { user } = authResult;

    const { to, amount } = await context.request.json() as { to: string; amount: number };

    if (!to || !amount) {
      return errorResponse('Missing required fields: to, amount', 400);
    }

    const senderClient = getSpliceClientForUser(context.env, user.username);

    console.log(`Creating transfer offer from ${user.username} to ${to} for ${amount} CC`);
    const offerResult = await senderClient.createTransferOffer(
      to,
      amount.toString(),
      'Transfer from Canton Wallet'
    );

    console.log('Offer result:', JSON.stringify(offerResult, null, 2));
    const contractId = offerResult.offer_contract_id || offerResult.contract_id || offerResult.contractId;
    console.log(`Transfer offer created with contract ID: ${contractId}`);

    // Record the send transaction as pending
    try {
      await recordTransaction(context.env.DB, {
        userId: user.id,
        txHash: contractId,
        txType: 'send',
        status: 'pending',
        assetSymbol: 'CC',
        chain: 'Canton',
        chainType: 'canton',
        amount: amount.toString(),
        fromAddress: user.partyId || user.username,
        toAddress: to,
        description: 'Transfer from Canton Wallet',
        metadata: {
          contractId,
          trackingId: offerResult.tracking_id
        }
      });
    } catch (txError) {
      console.error('Failed to record transaction:', txError);
      // Don't fail the transfer if recording fails
    }

    return jsonResponse({
      success: true,
      data: {
        transactionId: offerResult.tracking_id || contractId,
        contractId: contractId,
        to,
        amount,
        status: 'pending_acceptance'
      }
    });
  } catch (error) {
    console.error('Error processing transfer:', error);
    return errorResponse(error instanceof Error ? error.message : 'Failed to process transfer');
  }
}

export async function onRequestOptions(context: { request: Request }) {
  return handleCors(context.request);
}
