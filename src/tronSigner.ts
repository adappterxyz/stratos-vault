/**
 * Client-side TRON Transaction Signing
 *
 * Uses @noble/secp256k1 for cryptographic operations.
 * Supports TRX transfers and TRC20 token transfers.
 */

import { secp256k1 } from '@noble/curves/secp256k1.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { keccak_256 } from '@noble/hashes/sha3.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';

// ZAN.top RPC endpoints for TRON
const ZAN_API_KEY = '4a6373aaef354ba88416fbe73cd1c616';

export const TRON_RPC_ENDPOINTS = {
  mainnet: `https://api.zan.top/node/v1/tron/mainnet/${ZAN_API_KEY}`,
  shasta: `https://api.zan.top/node/v1/tron/shasta/${ZAN_API_KEY}`, // testnet
};

export type TronNetwork = 'mainnet' | 'shasta';

export interface TronTransaction {
  to: string;
  amount: number; // in SUN (1 TRX = 1e6 SUN)
  network?: TronNetwork;
}

export interface SignedTronTransaction {
  rawTransaction: string;
  txID: string;
  signature: string;
}

// Base58 alphabet
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

// Double SHA256
function hash256(data: Uint8Array): Uint8Array {
  return sha256(sha256(data));
}

// Get public key from private key
export function getPublicKey(privateKeyHex: string): Uint8Array {
  const cleanKey = privateKeyHex.startsWith('0x') ? privateKeyHex.slice(2) : privateKeyHex;
  return secp256k1.getPublicKey(hexToBytes(cleanKey), false); // Uncompressed
}

// Get TRON address from public key
export function getAddressFromPublicKey(publicKey: Uint8Array): string {
  // Remove 04 prefix if present
  const pubKeyNoPrefix = publicKey.length === 65 ? publicKey.slice(1) : publicKey;

  // Keccak256 hash of public key
  const hash = keccak_256(pubKeyNoPrefix);

  // Take last 20 bytes and add 0x41 prefix (TRON mainnet)
  const addressBytes = new Uint8Array(21);
  addressBytes[0] = 0x41; // TRON mainnet prefix
  addressBytes.set(hash.slice(12), 1);

  // Add checksum (first 4 bytes of double SHA256)
  const checksum = hash256(addressBytes).slice(0, 4);

  // Full address with checksum
  const fullAddress = new Uint8Array(25);
  fullAddress.set(addressBytes);
  fullAddress.set(checksum, 21);

  return base58Encode(fullAddress);
}

// Get address from private key
export function getAddressFromPrivateKey(privateKeyHex: string): string {
  const publicKey = getPublicKey(privateKeyHex);
  return getAddressFromPublicKey(publicKey);
}

// Convert TRON address to hex format
export function addressToHex(address: string): string {
  if (address.startsWith('T')) {
    // Base58 address
    const decoded = base58Decode(address);
    // Remove checksum (last 4 bytes)
    return bytesToHex(decoded.slice(0, 21));
  } else if (address.startsWith('41')) {
    return address;
  } else if (address.startsWith('0x')) {
    return '41' + address.slice(2);
  }
  throw new Error('Invalid TRON address format');
}

// Convert hex address to base58
export function hexToAddress(hex: string): string {
  const cleanHex = hex.startsWith('0x') ? hex.slice(2) : hex;
  const addressBytes = hexToBytes(cleanHex.startsWith('41') ? cleanHex : '41' + cleanHex);

  const checksum = hash256(addressBytes).slice(0, 4);
  const fullAddress = new Uint8Array(25);
  fullAddress.set(addressBytes);
  fullAddress.set(checksum, 21);

  return base58Encode(fullAddress);
}

// API call to TRON node
async function apiCall(network: TronNetwork, endpoint: string, body?: any): Promise<any> {
  const baseUrl = TRON_RPC_ENDPOINTS[network];

  const response = await fetch(`${baseUrl}${endpoint}`, {
    method: body ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined
  });

  const result = await response.json() as any;
  if (result.Error) {
    throw new Error(result.Error);
  }
  return result;
}

// Get account info
export async function getAccount(address: string, network: TronNetwork = 'mainnet'): Promise<any> {
  return await apiCall(network, '/wallet/getaccount', {
    address: addressToHex(address),
    visible: false
  });
}

// Get balance in SUN
export async function getBalance(address: string, network: TronNetwork = 'mainnet'): Promise<number> {
  try {
    const account = await getAccount(address, network);
    return account.balance || 0;
  } catch {
    return 0;
  }
}

// Get TRC20 token balance
export async function getTokenBalance(
  contractAddress: string,
  walletAddress: string,
  network: TronNetwork = 'mainnet'
): Promise<bigint> {
  try {
    // TRC20 balanceOf function selector
    const functionSelector = 'balanceOf(address)';
    const walletHex = addressToHex(walletAddress);
    // Parameter is the address padded to 32 bytes (remove 41 prefix)
    const parameter = walletHex.slice(2).padStart(64, '0');

    const result = await apiCall(network, '/wallet/triggersmartcontract', {
      owner_address: walletHex,
      contract_address: addressToHex(contractAddress),
      function_selector: functionSelector,
      parameter,
      visible: false
    });

    if (result.constant_result && result.constant_result.length > 0) {
      const hexBalance = result.constant_result[0];
      return BigInt('0x' + hexBalance);
    }
    return 0n;
  } catch (err) {
    console.error('Error fetching TRC20 token balance:', err);
    return 0n;
  }
}

// Create TRX transfer transaction
export async function createTransaction(
  fromAddress: string,
  toAddress: string,
  amount: number,
  network: TronNetwork = 'mainnet'
): Promise<any> {
  return await apiCall(network, '/wallet/createtransaction', {
    owner_address: addressToHex(fromAddress),
    to_address: addressToHex(toAddress),
    amount,
    visible: false
  });
}

// Broadcast signed transaction
export async function broadcastTransaction(signedTx: any, network: TronNetwork = 'mainnet'): Promise<any> {
  return await apiCall(network, '/wallet/broadcasttransaction', signedTx);
}

/**
 * Sign a TRON transaction
 *
 * @param toAddress Recipient address (base58)
 * @param amount Amount in SUN
 * @param privateKeyHex Private key as hex
 * @param network Network (mainnet or shasta)
 */
export async function signTransaction(
  toAddress: string,
  amount: number,
  privateKeyHex: string,
  network: TronNetwork = 'mainnet'
): Promise<SignedTronTransaction> {
  const cleanKey = privateKeyHex.startsWith('0x') ? privateKeyHex.slice(2) : privateKeyHex;
  const privateKeyBytes = hexToBytes(cleanKey);

  const fromAddress = getAddressFromPrivateKey(privateKeyHex);

  // Create unsigned transaction via API
  const unsignedTx = await createTransaction(fromAddress, toAddress, amount, network);

  if (!unsignedTx.txID) {
    throw new Error('Failed to create transaction');
  }

  // Sign the transaction ID with recovered format (65 bytes: r(32) + s(32) + recovery(1))
  const txIdBytes = hexToBytes(unsignedTx.txID);
  const signatureBytes = secp256k1.sign(txIdBytes, privateKeyBytes, { prehash: false, lowS: true, format: 'recovered' });

  // Format signature (r + s + v)
  const r = bytesToHex(signatureBytes.slice(0, 32));
  const s = bytesToHex(signatureBytes.slice(32, 64));
  const v = (signatureBytes[64] + 27).toString(16).padStart(2, '0');
  const signature = r + s + v;

  // Add signature to transaction
  const signedTx = {
    ...unsignedTx,
    signature: [signature]
  };

  return {
    rawTransaction: JSON.stringify(signedTx),
    txID: unsignedTx.txID,
    signature
  };
}

/**
 * Sign and send a TRON transaction
 */
export async function signAndSendTransaction(
  toAddress: string,
  amount: number,
  privateKeyHex: string,
  network: TronNetwork = 'mainnet'
): Promise<{ txID: string; status: 'pending' | 'failed' }> {
  const signed = await signTransaction(toAddress, amount, privateKeyHex, network);
  const signedTx = JSON.parse(signed.rawTransaction);

  const result = await broadcastTransaction(signedTx, network);

  return {
    txID: signed.txID,
    status: result.result ? 'pending' : 'failed'
  };
}

/**
 * Sign an arbitrary message
 */
export function signMessage(message: string, privateKeyHex: string): string {
  const cleanKey = privateKeyHex.startsWith('0x') ? privateKeyHex.slice(2) : privateKeyHex;
  const privateKeyBytes = hexToBytes(cleanKey);

  // TRON message signing format: "\x19TRON Signed Message:\n" + message.length + message
  const prefix = '\x19TRON Signed Message:\n' + message.length;
  const prefixedMessage = new TextEncoder().encode(prefix + message);
  const messageHash = keccak_256(prefixedMessage);

  // Sign with recovered format (65 bytes: r(32) + s(32) + recovery(1))
  const signatureBytes = secp256k1.sign(messageHash, privateKeyBytes, { prehash: false, lowS: true, format: 'recovered' });

  const r = bytesToHex(signatureBytes.slice(0, 32));
  const s = bytesToHex(signatureBytes.slice(32, 64));
  const v = (signatureBytes[64] + 27).toString(16).padStart(2, '0');

  return '0x' + r + s + v;
}

/**
 * Trigger a TRC20 token transfer
 */
export async function transferTRC20(
  contractAddress: string,
  toAddress: string,
  amount: bigint,
  privateKeyHex: string,
  network: TronNetwork = 'mainnet'
): Promise<{ txID: string; status: 'pending' | 'failed' }> {
  const cleanKey = privateKeyHex.startsWith('0x') ? privateKeyHex.slice(2) : privateKeyHex;
  const privateKeyBytes = hexToBytes(cleanKey);
  const fromAddress = getAddressFromPrivateKey(privateKeyHex);

  // Encode transfer function call
  // transfer(address,uint256) = keccak256("transfer(address,uint256)").slice(0, 4) = a9059cbb
  const toHex = addressToHex(toAddress).slice(2); // Remove 41 prefix, pad to 64 chars
  const amountHex = amount.toString(16).padStart(64, '0');
  const parameter = toHex.padStart(64, '0') + amountHex;

  // Create trigger smart contract transaction
  const unsignedTx = await apiCall(network, '/wallet/triggersmartcontract', {
    owner_address: addressToHex(fromAddress),
    contract_address: addressToHex(contractAddress),
    function_selector: 'transfer(address,uint256)',
    parameter,
    fee_limit: 100000000, // 100 TRX
    call_value: 0,
    visible: false
  });

  if (!unsignedTx.transaction || !unsignedTx.transaction.txID) {
    throw new Error(unsignedTx.result?.message || 'Failed to create TRC20 transfer');
  }

  const txID = unsignedTx.transaction.txID;
  const txIdBytes = hexToBytes(txID);
  // Sign with recovered format (65 bytes: r(32) + s(32) + recovery(1))
  const signatureBytes = secp256k1.sign(txIdBytes, privateKeyBytes, { prehash: false, lowS: true, format: 'recovered' });

  const r = bytesToHex(signatureBytes.slice(0, 32));
  const s = bytesToHex(signatureBytes.slice(32, 64));
  const v = (signatureBytes[64] + 27).toString(16).padStart(2, '0');
  const signature = r + s + v;

  const signedTx = {
    ...unsignedTx.transaction,
    signature: [signature]
  };

  const result = await broadcastTransaction(signedTx, network);

  return {
    txID,
    status: result.result ? 'pending' : 'failed'
  };
}
