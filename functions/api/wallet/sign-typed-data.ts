/**
 * EIP-712 Typed Data Signing API
 *
 * Signs EIP-712 typed data using user's stored private key.
 */

import { jsonResponse, errorResponse, handleCors, requireAuth, Env } from '../../_lib/utils';

interface EIP712Domain {
  name?: string;
  version?: string;
  chainId?: number;
  verifyingContract?: string;
  salt?: string;
}

interface EIP712TypedData {
  types: Record<string, Array<{ name: string; type: string }>>;
  primaryType: string;
  domain: EIP712Domain;
  message: Record<string, unknown>;
}

interface RequestBody {
  typedData: EIP712TypedData;
}

export async function onRequestPost(context: { request: Request; env: Env }) {
  const corsResponse = handleCors(context.request);
  if (corsResponse) return corsResponse;

  try {
    const authResult = await requireAuth(context.request, context.env.DB);
    if (authResult instanceof Response) return authResult;
    const { user } = authResult;

    const body = await context.request.json() as RequestBody;
    const { typedData } = body;

    if (!typedData || !typedData.types || !typedData.primaryType || !typedData.domain || !typedData.message) {
      return errorResponse('Missing required fields in typedData', 400);
    }

    // Get user's EVM wallet from database
    const wallet = await context.env.DB.prepare(
      'SELECT address, private_key_encrypted FROM user_wallets WHERE user_id = ? AND chain_type = ?'
    ).bind(user.id, 'evm').first<{ address: string; private_key_encrypted: string }>();

    if (!wallet) {
      return errorResponse('No EVM wallet found for user', 404);
    }

    // Note: Similar to evm-transaction, actual signing requires decrypted private key
    // For EIP-712, the signing process is:
    // 1. Hash the domain separator
    // 2. Hash the structured data
    // 3. Combine: keccak256("\x19\x01" + domainSeparator + structHash)
    // 4. Sign the hash with secp256k1

    // For now, return the prepared data for client-side signing
    return jsonResponse({
      success: true,
      data: {
        typedData,
        signerAddress: wallet.address,
        message: 'EIP-712 signing prepared. Client-side signing with PRF required for production.'
      }
    });

  } catch (error) {
    console.error('Sign typed data error:', error);
    return errorResponse(error instanceof Error ? error.message : 'Signing failed');
  }
}

export async function onRequestOptions(context: { request: Request }) {
  return handleCors(context.request);
}
