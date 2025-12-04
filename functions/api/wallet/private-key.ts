/**
 * Private Key Retrieval API
 *
 * Returns the encrypted private key for a specific chain type.
 * The key is encrypted with PRF and must be decrypted client-side.
 */

import { jsonResponse, errorResponse, handleCors, requireAuth, Env } from '../../_lib/utils';

export async function onRequestGet(context: { request: Request; env: Env }) {
  const corsResponse = handleCors(context.request);
  if (corsResponse) return corsResponse;

  try {
    // Require active session
    const authResult = await requireAuth(context.request, context.env.DB);
    if (authResult instanceof Response) return authResult;
    const { user } = authResult;

    // Get chain type from query params
    const url = new URL(context.request.url);
    const chainType = url.searchParams.get('chainType');

    if (!chainType) {
      return errorResponse('chainType query parameter is required', 400);
    }

    // Valid chain types
    const validChainTypes = ['evm', 'svm', 'btc', 'tron', 'ton'];
    if (!validChainTypes.includes(chainType)) {
      return errorResponse(`Invalid chainType. Must be one of: ${validChainTypes.join(', ')}`, 400);
    }

    // Get encrypted private key from database
    const wallet = await context.env.DB.prepare(
      'SELECT private_key_encrypted FROM wallet_addresses WHERE user_id = ? AND chain_type = ?'
    ).bind(user.id, chainType).first<{ private_key_encrypted: string }>();

    if (!wallet) {
      return errorResponse(`No ${chainType} wallet found for user`, 404);
    }

    return jsonResponse({
      success: true,
      data: {
        encryptedKey: wallet.private_key_encrypted,
        chainType
      }
    });
  } catch (error) {
    console.error('Error fetching private key:', error);
    return errorResponse(error instanceof Error ? error.message : 'Failed to fetch private key');
  }
}

export async function onRequestOptions(context: { request: Request }) {
  return handleCors(context.request);
}
