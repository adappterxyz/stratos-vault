/**
 * Client-side Solana Transaction Signing
 *
 * Uses @noble/ed25519 for cryptographic operations.
 * Supports SOL transfers and SPL token transfers.
 */

import { ed25519 } from '@noble/curves/ed25519.js';
import { hexToBytes } from '@noble/hashes/utils.js';

// ZAN.top RPC endpoints for Solana
const ZAN_API_KEY = '4a6373aaef354ba88416fbe73cd1c616';

export const SOL_RPC_ENDPOINTS = {
  mainnet: `https://api.zan.top/node/v1/solana/mainnet/${ZAN_API_KEY}`,
  devnet: `https://api.zan.top/node/v1/solana/devnet/${ZAN_API_KEY}`,
};

export type SolanaNetwork = 'mainnet' | 'devnet';

export interface SolanaTransaction {
  to: string;
  amount: number; // in lamports (1 SOL = 1e9 lamports)
  network?: SolanaNetwork;
}

export interface SignedSolanaTransaction {
  rawTransaction: string; // base64 encoded
  signature: string;
}

// Base58 alphabet (Bitcoin/Solana style)
const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

function base58Encode(bytes: Uint8Array): string {
  const digits = [0];
  for (let i = 0; i < bytes.length; i++) {
    let carry = bytes[i];
    for (let j = 0; j < digits.length; j++) {
      carry += digits[j] << 8;
      digits[j] = carry % 58;
      carry = (carry / 58) | 0;
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = (carry / 58) | 0;
    }
  }
  let result = '';
  for (let i = 0; i < bytes.length && bytes[i] === 0; i++) {
    result += '1';
  }
  for (let i = digits.length - 1; i >= 0; i--) {
    result += BASE58_ALPHABET[digits[i]];
  }
  return result;
}

function base58Decode(str: string): Uint8Array {
  const bytes: number[] = [];
  for (let i = 0; i < str.length; i++) {
    const value = BASE58_ALPHABET.indexOf(str[i]);
    if (value < 0) throw new Error('Invalid base58 character');

    let carry = value;
    for (let j = 0; j < bytes.length; j++) {
      carry += bytes[j] * 58;
      bytes[j] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  // Add leading zeros
  for (let i = 0; i < str.length && str[i] === '1'; i++) {
    bytes.push(0);
  }
  return new Uint8Array(bytes.reverse());
}

// Get public key from private key
export function getPublicKey(privateKeyHex: string): Uint8Array {
  const cleanKey = privateKeyHex.startsWith('0x') ? privateKeyHex.slice(2) : privateKeyHex;
  const privateKeyBytes = hexToBytes(cleanKey);

  // For Solana, the "private key" is typically the 64-byte keypair (32 bytes private + 32 bytes public)
  // or just the 32-byte seed
  if (privateKeyBytes.length === 64) {
    return privateKeyBytes.slice(32);
  } else if (privateKeyBytes.length === 32) {
    return ed25519.getPublicKey(privateKeyBytes);
  }
  throw new Error('Invalid private key length');
}

// Get Solana address from public key
export function getAddressFromPublicKey(publicKey: Uint8Array): string {
  return base58Encode(publicKey);
}

// Get address from private key
export function getAddressFromPrivateKey(privateKeyHex: string): string {
  const publicKey = getPublicKey(privateKeyHex);
  return base58Encode(publicKey);
}

// RPC call to ZAN Solana node
async function rpcCall(network: SolanaNetwork, method: string, params: any[]): Promise<any> {
  const rpcUrl = SOL_RPC_ENDPOINTS[network];

  const response = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: Date.now(),
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

// Get balance in lamports
export async function getBalance(address: string, network: SolanaNetwork = 'mainnet'): Promise<number> {
  const result = await rpcCall(network, 'getBalance', [address]);
  return result.value;
}

// Get SPL token balance
export async function getTokenBalance(
  tokenMintAddress: string,
  walletAddress: string,
  network: SolanaNetwork = 'mainnet'
): Promise<bigint> {
  try {
    // Get token accounts by owner
    const result = await rpcCall(network, 'getTokenAccountsByOwner', [
      walletAddress,
      { mint: tokenMintAddress },
      { encoding: 'jsonParsed' }
    ]);

    if (result.value && result.value.length > 0) {
      // Sum up all token account balances
      let totalBalance = 0n;
      for (const account of result.value) {
        const tokenAmount = account.account?.data?.parsed?.info?.tokenAmount;
        if (tokenAmount?.amount) {
          totalBalance += BigInt(tokenAmount.amount);
        }
      }
      return totalBalance;
    }
    return 0n;
  } catch (err) {
    console.error('Error fetching SPL token balance:', err);
    return 0n;
  }
}

// Get recent blockhash
export async function getRecentBlockhash(network: SolanaNetwork = 'mainnet'): Promise<string> {
  const result = await rpcCall(network, 'getLatestBlockhash', [{ commitment: 'finalized' }]);
  return result.value.blockhash;
}

// Get minimum balance for rent exemption
export async function getMinimumBalanceForRentExemption(dataLength: number, network: SolanaNetwork = 'mainnet'): Promise<number> {
  return await rpcCall(network, 'getMinimumBalanceForRentExemption', [dataLength]);
}

// Send transaction
export async function sendTransaction(signedTx: string, network: SolanaNetwork = 'mainnet'): Promise<string> {
  return await rpcCall(network, 'sendTransaction', [signedTx, { encoding: 'base64' }]);
}

// Compact-u16 encoding for Solana
function encodeCompactU16(value: number): Uint8Array {
  const bytes: number[] = [];
  while (value > 0x7f) {
    bytes.push((value & 0x7f) | 0x80);
    value >>= 7;
  }
  bytes.push(value);
  return new Uint8Array(bytes);
}

// System Program ID (11111111111111111111111111111111)
const SYSTEM_PROGRAM_ID = new Uint8Array(32).fill(0);
SYSTEM_PROGRAM_ID[0] = 0;

// Create transfer instruction data
function createTransferInstructionData(lamports: number): Uint8Array {
  // Transfer instruction index is 2
  const data = new Uint8Array(12);
  data[0] = 2; // Transfer instruction
  data[1] = 0;
  data[2] = 0;
  data[3] = 0;
  // Lamports as u64 little-endian
  const view = new DataView(data.buffer);
  view.setBigUint64(4, BigInt(lamports), true);
  return data;
}

/**
 * Sign a Solana SOL transfer transaction
 *
 * @param toAddress Recipient address (base58)
 * @param amount Amount in lamports
 * @param privateKeyHex Private key (32 or 64 bytes as hex)
 * @param network Network (mainnet or devnet)
 */
export async function signTransaction(
  toAddress: string,
  amount: number,
  privateKeyHex: string,
  network: SolanaNetwork = 'mainnet'
): Promise<SignedSolanaTransaction> {
  const cleanKey = privateKeyHex.startsWith('0x') ? privateKeyHex.slice(2) : privateKeyHex;
  const privateKeyBytes = hexToBytes(cleanKey);

  // Get the actual 32-byte signing key
  let signingKey: Uint8Array;
  let publicKey: Uint8Array;

  if (privateKeyBytes.length === 64) {
    signingKey = privateKeyBytes.slice(0, 32);
    publicKey = privateKeyBytes.slice(32);
  } else if (privateKeyBytes.length === 32) {
    signingKey = privateKeyBytes;
    publicKey = ed25519.getPublicKey(signingKey);
  } else {
    throw new Error('Invalid private key length');
  }

  const fromPubkey = publicKey;
  const toPubkey = base58Decode(toAddress);

  // Get recent blockhash
  const blockhash = await getRecentBlockhash(network);
  const blockhashBytes = base58Decode(blockhash);

  // Build transaction message
  // Header: num_required_signatures, num_readonly_signed, num_readonly_unsigned
  const header = new Uint8Array([1, 0, 1]); // 1 signer, 0 readonly signed, 1 readonly unsigned (system program)

  // Account keys: from, to, system program
  const accountKeys = new Uint8Array(32 * 3);
  accountKeys.set(fromPubkey, 0);
  accountKeys.set(toPubkey, 32);
  accountKeys.set(SYSTEM_PROGRAM_ID, 64);

  // Recent blockhash
  const recentBlockhash = blockhashBytes;

  // Instructions
  const instructionData = createTransferInstructionData(amount);

  // Instruction format:
  // - program_id_index: u8
  // - accounts: compact-array of u8 (account indices)
  // - data: compact-array of u8
  const programIdIndex = 2; // System program is at index 2
  const accountIndices = new Uint8Array([0, 1]); // from (0), to (1)

  const instruction = new Uint8Array(1 + 1 + accountIndices.length + 1 + instructionData.length);
  let off = 0;
  instruction[off++] = programIdIndex;
  instruction[off++] = accountIndices.length;
  instruction.set(accountIndices, off);
  off += accountIndices.length;
  instruction[off++] = instructionData.length;
  instruction.set(instructionData, off);

  // Build message
  // Format: header + compact(account_keys) + recent_blockhash + compact(instructions)
  const numKeys = encodeCompactU16(3);
  const numInstructions = encodeCompactU16(1);

  const messageLength = header.length + numKeys.length + accountKeys.length + 32 + numInstructions.length + instruction.length;
  const message = new Uint8Array(messageLength);
  off = 0;
  message.set(header, off); off += header.length;
  message.set(numKeys, off); off += numKeys.length;
  message.set(accountKeys, off); off += accountKeys.length;
  message.set(recentBlockhash, off); off += 32;
  message.set(numInstructions, off); off += numInstructions.length;
  message.set(instruction, off);

  // Sign message
  const signature = ed25519.sign(message, signingKey);

  // Build transaction
  // Format: compact(signatures) + message
  const numSignatures = encodeCompactU16(1);
  const transaction = new Uint8Array(numSignatures.length + 64 + message.length);
  off = 0;
  transaction.set(numSignatures, off); off += numSignatures.length;
  transaction.set(signature, off); off += 64;
  transaction.set(message, off);

  // Encode as base64
  const rawTransaction = btoa(String.fromCharCode(...transaction));

  return {
    rawTransaction,
    signature: base58Encode(signature)
  };
}

/**
 * Sign and send a Solana transaction
 */
export async function signAndSendTransaction(
  toAddress: string,
  amount: number,
  privateKeyHex: string,
  network: SolanaNetwork = 'mainnet'
): Promise<{ signature: string; status: 'pending' }> {
  const signed = await signTransaction(toAddress, amount, privateKeyHex, network);
  const signature = await sendTransaction(signed.rawTransaction, network);

  return {
    signature,
    status: 'pending'
  };
}

/**
 * Sign an arbitrary message
 */
export function signMessage(message: string, privateKeyHex: string): string {
  const cleanKey = privateKeyHex.startsWith('0x') ? privateKeyHex.slice(2) : privateKeyHex;
  const privateKeyBytes = hexToBytes(cleanKey);

  let signingKey: Uint8Array;
  if (privateKeyBytes.length === 64) {
    signingKey = privateKeyBytes.slice(0, 32);
  } else if (privateKeyBytes.length === 32) {
    signingKey = privateKeyBytes;
  } else {
    throw new Error('Invalid private key length');
  }

  const messageBytes = new TextEncoder().encode(message);
  const signature = ed25519.sign(messageBytes, signingKey);

  return base58Encode(signature);
}
