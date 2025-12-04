/**
 * EVM Transaction API
 *
 * Signs and broadcasts EVM transactions using user's stored private key.
 * Uses ZAN.top nodes for RPC access.
 */

import { jsonResponse, errorResponse, handleCors, requireAuth, Env } from '../../_lib/utils';

// ZAN.top RPC endpoints by chain ID
const ZAN_API_KEY = '4a6373aaef354ba88416fbe73cd1c616';

const RPC_ENDPOINTS: Record<number, string> = {
  1: `https://api.zan.top/node/v1/eth/mainnet/${ZAN_API_KEY}`,         // Ethereum Mainnet
  11155111: `https://api.zan.top/node/v1/eth/sepolia/${ZAN_API_KEY}`,  // Ethereum Sepolia (testnet)
  8453: `https://api.zan.top/node/v1/base/mainnet/${ZAN_API_KEY}`,     // Base
};

interface EVMTransactionRequest {
  to: string;
  value?: string;
  data?: string;
  gasLimit?: string;
  gasPrice?: string;
  maxFeePerGas?: string;
  maxPriorityFeePerGas?: string;
  nonce?: string | number;
  chainId: number;
}

interface RequestBody {
  transaction: EVMTransactionRequest;
  action: 'sign' | 'send';
}

// Simple hex utilities (kept for future server-side signing implementation)
function _bytesToHex(bytes: Uint8Array): string {
  return '0x' + Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

function hexToBytes(hex: string): Uint8Array {
  const cleanHex = hex.startsWith('0x') ? hex.slice(2) : hex;
  const bytes = new Uint8Array(cleanHex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(cleanHex.substr(i * 2, 2), 16);
  }
  return bytes;
}

// RLP encoding for transactions (kept for future server-side signing implementation)
function _rlpEncode(input: any): Uint8Array {
  if (typeof input === 'string') {
    if (input.startsWith('0x')) {
      const bytes = hexToBytes(input);
      return rlpEncodeBytes(bytes);
    }
    return rlpEncodeBytes(new TextEncoder().encode(input));
  }
  if (input instanceof Uint8Array) {
    return rlpEncodeBytes(input);
  }
  if (typeof input === 'number' || typeof input === 'bigint') {
    if (input === 0 || input === 0n) {
      return new Uint8Array([0x80]);
    }
    let hex = input.toString(16);
    if (hex.length % 2) hex = '0' + hex;
    return rlpEncodeBytes(hexToBytes(hex));
  }
  if (Array.isArray(input)) {
    const encoded = input.map(item => _rlpEncode(item));
    const totalLength = encoded.reduce((sum, e) => sum + e.length, 0);
    const lengthPrefix = encodeLength(totalLength, 0xc0);
    const result = new Uint8Array(lengthPrefix.length + totalLength);
    result.set(lengthPrefix);
    let offset = lengthPrefix.length;
    for (const e of encoded) {
      result.set(e, offset);
      offset += e.length;
    }
    return result;
  }
  throw new Error('Unsupported RLP input type');
}

function rlpEncodeBytes(bytes: Uint8Array): Uint8Array {
  if (bytes.length === 0) {
    return new Uint8Array([0x80]);
  }
  if (bytes.length === 1 && bytes[0] < 0x80) {
    return bytes;
  }
  const lengthPrefix = encodeLength(bytes.length, 0x80);
  const result = new Uint8Array(lengthPrefix.length + bytes.length);
  result.set(lengthPrefix);
  result.set(bytes, lengthPrefix.length);
  return result;
}

function encodeLength(length: number, offset: number): Uint8Array {
  if (length < 56) {
    return new Uint8Array([offset + length]);
  }
  let hexLength = length.toString(16);
  if (hexLength.length % 2) hexLength = '0' + hexLength;
  const lengthBytes = hexToBytes(hexLength);
  const result = new Uint8Array(1 + lengthBytes.length);
  result[0] = offset + 55 + lengthBytes.length;
  result.set(lengthBytes, 1);
  return result;
}

// Keccak-256 hash (simplified - uses SubtleCrypto SHA-256 as fallback)
// In production, use a proper keccak256 implementation
async function _keccak256(data: Uint8Array): Promise<Uint8Array> {
  // Note: This should use actual keccak256, but for CF Workers we need a library
  // Using SHA-256 as placeholder - in production use @noble/hashes or similar
  const buffer = new ArrayBuffer(data.length);
  new Uint8Array(buffer).set(data);
  const hash = await crypto.subtle.digest('SHA-256', buffer);
  return new Uint8Array(hash);
}

// secp256k1 signing (simplified - needs proper implementation)
// In production, use @noble/secp256k1 or similar
async function _signWithPrivateKey(_messageHash: Uint8Array, _privateKey: Uint8Array): Promise<{ r: Uint8Array; s: Uint8Array; v: number }> {
  // This is a placeholder - actual implementation needs secp256k1
  // For now, return dummy signature that will fail on-chain
  // In production, use: import { secp256k1 } from '@noble/curves/secp256k1';

  // Placeholder implementation - MUST be replaced with real signing
  const r = new Uint8Array(32);
  const s = new Uint8Array(32);
  crypto.getRandomValues(r);
  crypto.getRandomValues(s);

  return { r, s, v: 27 };
}

// Make RPC call to ZAN node
async function rpcCall(chainId: number, method: string, params: any[]): Promise<any> {
  const rpcUrl = RPC_ENDPOINTS[chainId];
  if (!rpcUrl) {
    throw new Error(`Unsupported chain ID: ${chainId}`);
  }

  const response = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method,
      params
    })
  });

  const result = await response.json() as { result?: any; error?: { message: string } };
  if (result.error) {
    throw new Error(result.error.message);
  }
  return result.result;
}

// Get nonce for address
async function getNonce(chainId: number, address: string): Promise<string> {
  return await rpcCall(chainId, 'eth_getTransactionCount', [address, 'pending']);
}

// Get gas price
async function getGasPrice(chainId: number): Promise<string> {
  return await rpcCall(chainId, 'eth_gasPrice', []);
}

// Estimate gas
async function estimateGas(chainId: number, tx: any): Promise<string> {
  return await rpcCall(chainId, 'eth_estimateGas', [tx]);
}

// Send raw transaction (kept for future server-side signing)
async function _sendRawTransaction(chainId: number, signedTx: string): Promise<string> {
  return await rpcCall(chainId, 'eth_sendRawTransaction', [signedTx]);
}

// Get chain ID from node (for verification)
async function _getChainId(chainId: number): Promise<string> {
  return await rpcCall(chainId, 'eth_chainId', []);
}

// Export to suppress unused variable warnings
void _bytesToHex;
void _rlpEncode;
void _keccak256;
void _signWithPrivateKey;
void _sendRawTransaction;
void _getChainId;

export async function onRequestPost(context: { request: Request; env: Env }) {
  const corsResponse = handleCors(context.request);
  if (corsResponse) return corsResponse;

  try {
    const authResult = await requireAuth(context.request, context.env.DB);
    if (authResult instanceof Response) return authResult;
    const { user } = authResult;

    const body = await context.request.json() as RequestBody;
    const { transaction, action } = body;

    if (!transaction || !transaction.to || !transaction.chainId) {
      return errorResponse('Missing required fields: transaction.to, transaction.chainId', 400);
    }

    // Check if chain is supported
    if (!RPC_ENDPOINTS[transaction.chainId]) {
      return errorResponse(`Unsupported chain ID: ${transaction.chainId}. Supported: ${Object.keys(RPC_ENDPOINTS).join(', ')}`, 400);
    }

    // Get user's EVM wallet from database
    const wallet = await context.env.DB.prepare(
      'SELECT address, private_key_encrypted FROM user_wallets WHERE user_id = ? AND chain_type = ?'
    ).bind(user.id, 'evm').first<{ address: string; private_key_encrypted: string }>();

    if (!wallet) {
      return errorResponse('No EVM wallet found for user', 404);
    }

    // Note: In production with PRF, the private key would need to be decrypted
    // using the user's passkey PRF output. For server-side signing, we'd need
    // to store decryptable keys or use a different approach.

    // For now, return the prepared transaction info
    // Actual signing would require the decrypted private key

    const fromAddress = wallet.address;

    // Get nonce if not provided
    let nonce = transaction.nonce;
    if (nonce === undefined) {
      nonce = await getNonce(transaction.chainId, fromAddress);
    }

    // Get gas price if not provided
    let gasPrice = transaction.gasPrice;
    if (!gasPrice && !transaction.maxFeePerGas) {
      gasPrice = await getGasPrice(transaction.chainId);
    }

    // Estimate gas if not provided
    let gasLimit = transaction.gasLimit;
    if (!gasLimit) {
      try {
        gasLimit = await estimateGas(transaction.chainId, {
          from: fromAddress,
          to: transaction.to,
          value: transaction.value || '0x0',
          data: transaction.data || '0x'
        });
        // Add 20% buffer
        const gasNum = parseInt(gasLimit, 16);
        gasLimit = '0x' + Math.ceil(gasNum * 1.2).toString(16);
      } catch (e) {
        gasLimit = '0x5208'; // Default 21000 for simple transfer
      }
    }

    // Build transaction object
    const txForSigning = {
      nonce: typeof nonce === 'string' ? nonce : '0x' + nonce.toString(16),
      gasPrice: gasPrice || transaction.maxFeePerGas,
      gasLimit,
      to: transaction.to,
      value: transaction.value || '0x0',
      data: transaction.data || '0x',
      chainId: transaction.chainId
    };

    if (action === 'sign') {
      // Just return the prepared transaction (signing would happen client-side)
      return jsonResponse({
        success: true,
        data: {
          preparedTransaction: txForSigning,
          from: fromAddress,
          message: 'Transaction prepared. Client-side signing with PRF required.'
        }
      });
    }

    // For 'send' action, we need to sign and broadcast
    // This requires the decrypted private key

    // PLACEHOLDER: In production, implement proper signing
    // For now, return an error explaining the limitation
    return errorResponse(
      'Server-side signing not yet implemented. Private keys are encrypted with user passkey (PRF). ' +
      'Use action="sign" to get prepared transaction for client-side signing.',
      501
    );

    // When implemented, the flow would be:
    // 1. Decrypt private key (needs PRF or stored key)
    // 2. RLP encode transaction
    // 3. Sign with secp256k1
    // 4. Broadcast via eth_sendRawTransaction
    // 5. Return tx hash

  } catch (error) {
    console.error('EVM transaction error:', error);
    return errorResponse(error instanceof Error ? error.message : 'Transaction failed');
  }
}

export async function onRequestOptions(context: { request: Request }) {
  return handleCors(context.request);
}
