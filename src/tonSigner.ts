/**
 * Client-side TON (The Open Network) Transaction Signing
 *
 * Uses @noble/ed25519 for cryptographic operations.
 * Supports TON transfers.
 */

import { ed25519 } from '@noble/curves/ed25519.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';

// RPC endpoints - must be set via setTonRpcEndpoints() from config
let tonRpcEndpoints: Record<string, string> = {};

// Set RPC endpoints from config
export function setTonRpcEndpoints(endpoints: Record<string, string>): void {
  tonRpcEndpoints = { ...endpoints };
}

export type TonNetwork = 'mainnet' | 'testnet';

export interface TonTransaction {
  to: string;
  amount: bigint; // in nanotons (1 TON = 1e9 nanotons)
  message?: string;
  network?: TonNetwork;
}

export interface SignedTonTransaction {
  boc: string; // Base64 encoded BOC
  hash: string;
}

// Base64 encoding/decoding
function base64Encode(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

function base64Decode(str: string): Uint8Array {
  const binary = atob(str);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

// Base64url encoding for TON addresses
function base64UrlEncode(bytes: Uint8Array): string {
  const base64 = btoa(String.fromCharCode(...bytes));
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlDecode(str: string): Uint8Array {
  let base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  while (base64.length % 4) {
    base64 += '=';
  }
  return base64Decode(base64);
}

// CRC16 for TON addresses
function crc16(data: Uint8Array): number {
  const poly = 0x1021;
  let crc = 0;
  for (let i = 0; i < data.length; i++) {
    crc ^= data[i] << 8;
    for (let j = 0; j < 8; j++) {
      if (crc & 0x8000) {
        crc = (crc << 1) ^ poly;
      } else {
        crc <<= 1;
      }
      crc &= 0xffff;
    }
  }
  return crc;
}

// Get public key from private key (Ed25519)
export function getPublicKey(privateKeyHex: string): Uint8Array {
  const cleanKey = privateKeyHex.startsWith('0x') ? privateKeyHex.slice(2) : privateKeyHex;
  const privateKeyBytes = hexToBytes(cleanKey);

  try {
    if (privateKeyBytes.length === 64) {
      // Already includes public key
      return privateKeyBytes.slice(32);
    } else if (privateKeyBytes.length === 32) {
      return ed25519.getPublicKey(privateKeyBytes);
    }
    throw new Error('Invalid private key length');
  } finally {
    privateKeyBytes.fill(0);
  }
}

// Get TON address from public key (user-friendly format)
export function getAddressFromPublicKey(
  publicKey: Uint8Array,
  workchain: number = 0,
  bounceable: boolean = true
): string {
  // Calculate address hash (simplified - real TON uses StateInit)
  const addressHash = sha256(publicKey);

  // Build user-friendly address
  // Format: tag (1 byte) + workchain (1 byte) + hash (32 bytes) + crc16 (2 bytes)
  const tag = bounceable ? 0x11 : 0x51; // Bounceable or non-bounceable

  const addressData = new Uint8Array(34);
  addressData[0] = tag;
  addressData[1] = workchain & 0xff;
  addressData.set(addressHash, 2);

  const crc = crc16(addressData);
  const fullAddress = new Uint8Array(36);
  fullAddress.set(addressData);
  fullAddress[34] = (crc >> 8) & 0xff;
  fullAddress[35] = crc & 0xff;

  return base64UrlEncode(fullAddress);
}

// Get address from private key
export function getAddressFromPrivateKey(privateKeyHex: string, bounceable: boolean = true): string {
  const publicKey = getPublicKey(privateKeyHex);
  return getAddressFromPublicKey(publicKey, 0, bounceable);
}

// Parse TON address
export function parseAddress(address: string): { workchain: number; hash: Uint8Array; bounceable: boolean } {
  let bytes: Uint8Array;

  if (address.includes(':')) {
    // Raw format: workchain:hash
    const [wcStr, hashHex] = address.split(':');
    const workchain = parseInt(wcStr, 10);
    const hash = hexToBytes(hashHex);
    return { workchain, hash, bounceable: true };
  } else {
    // User-friendly format
    bytes = base64UrlDecode(address);
  }

  if (bytes.length !== 36) {
    throw new Error('Invalid address length');
  }

  const tag = bytes[0];
  const workchain = bytes[1] === 0xff ? -1 : bytes[1];
  const hash = bytes.slice(2, 34);
  const checksum = (bytes[34] << 8) | bytes[35];

  // Verify checksum
  const expectedCrc = crc16(bytes.slice(0, 34));
  if (checksum !== expectedCrc) {
    throw new Error('Invalid address checksum');
  }

  const bounceable = (tag & 0x11) === 0x11;

  return { workchain, hash, bounceable };
}

// Convert address to raw format
export function toRawAddress(address: string): string {
  const { workchain, hash } = parseAddress(address);
  return `${workchain}:${bytesToHex(hash)}`;
}

// API call to TON node (HTTP API format)
async function apiCall(network: TonNetwork, endpoint: string, params?: Record<string, any>): Promise<any> {
  const baseUrl = tonRpcEndpoints[network];

  const url = new URL(`${baseUrl}${endpoint}`);
  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      url.searchParams.append(key, String(value));
    });
  }

  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' }
  });

  const result = await response.json() as any;
  if (!result.ok) {
    throw new Error(result.error || 'API call failed');
  }
  return result.result;
}

// JSON-RPC call to TON node (kept for future use)
async function _rpcCall(network: TonNetwork, method: string, params: any): Promise<any> {
  const baseUrl = tonRpcEndpoints[network];

  const response = await fetch(baseUrl, {
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
void _rpcCall; // Suppress unused warning

// Get account info
export async function getAccountInfo(address: string, network: TonNetwork = 'mainnet'): Promise<any> {
  try {
    return await apiCall(network, '/getAddressInformation', { address });
  } catch {
    return null;
  }
}

// Get balance in nanotons
export async function getBalance(address: string, network: TonNetwork = 'mainnet'): Promise<bigint> {
  try {
    const info = await getAccountInfo(address, network);
    return BigInt(info?.balance || '0');
  } catch {
    return 0n;
  }
}

// Get seqno for wallet
export async function getSeqno(address: string, network: TonNetwork = 'mainnet'): Promise<number> {
  try {
    const result = await apiCall(network, '/runGetMethod', {
      address,
      method: 'seqno',
      stack: []
    });
    if (result.stack && result.stack[0]) {
      return parseInt(result.stack[0][1], 16);
    }
    return 0;
  } catch {
    return 0;
  }
}

// Send BOC (Bag of Cells)
export async function sendBoc(boc: string, network: TonNetwork = 'mainnet'): Promise<any> {
  const baseUrl = tonRpcEndpoints[network];

  const response = await fetch(`${baseUrl}/sendBoc`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ boc })
  });

  return await response.json();
}

// Simple cell builder for TON
class CellBuilder {
  private bits: boolean[] = [];
  private refs: Uint8Array[] = [];

  writeBit(bit: boolean): this {
    this.bits.push(bit);
    return this;
  }

  writeBits(value: number | bigint, count: number): this {
    const val = BigInt(value);
    for (let i = count - 1; i >= 0; i--) {
      this.bits.push(((val >> BigInt(i)) & 1n) === 1n);
    }
    return this;
  }

  writeUint(value: number | bigint, bits: number): this {
    return this.writeBits(value, bits);
  }

  writeInt(value: number | bigint, bits: number): this {
    const val = BigInt(value);
    if (val < 0n) {
      const mask = (1n << BigInt(bits)) - 1n;
      return this.writeBits((val & mask), bits);
    }
    return this.writeBits(val, bits);
  }

  writeCoins(value: bigint): this {
    if (value === 0n) {
      this.writeUint(0, 4);
      return this;
    }
    const bytes = Math.ceil(value.toString(16).length / 2);
    this.writeUint(bytes, 4);
    this.writeUint(value, bytes * 8);
    return this;
  }

  writeAddress(address: string | null): this {
    if (!address) {
      this.writeBits(0, 2); // addr_none
      return this;
    }

    const { workchain, hash } = parseAddress(address);

    this.writeBits(0b10, 2); // addr_std
    this.writeBit(false); // anycast
    this.writeInt(workchain, 8);
    for (let i = 0; i < 32; i++) {
      this.writeUint(hash[i], 8);
    }
    return this;
  }

  writeRef(cell: Uint8Array): this {
    this.refs.push(cell);
    return this;
  }

  build(): Uint8Array {
    // Simplified cell serialization
    const bitLength = this.bits.length;
    const byteLength = Math.ceil(bitLength / 8);
    const data = new Uint8Array(byteLength);

    for (let i = 0; i < bitLength; i++) {
      if (this.bits[i]) {
        data[Math.floor(i / 8)] |= (1 << (7 - (i % 8)));
      }
    }

    // Add completion tag if not byte-aligned
    if (bitLength % 8 !== 0) {
      data[byteLength - 1] |= (1 << (7 - (bitLength % 8)));
    }

    return data;
  }

  toCell(): { bits: Uint8Array; refs: Uint8Array[] } {
    return {
      bits: this.build(),
      refs: this.refs
    };
  }
}

/**
 * Sign a TON transaction
 *
 * Note: This is a simplified implementation. Production use requires
 * proper wallet contract interaction and BOC serialization.
 *
 * @param toAddress Recipient address
 * @param amount Amount in nanotons
 * @param privateKeyHex Private key as hex
 * @param message Optional comment message
 * @param network Network (mainnet or testnet)
 */
export async function signTransaction(
  toAddress: string,
  amount: bigint,
  privateKeyHex: string,
  message?: string,
  network: TonNetwork = 'mainnet'
): Promise<SignedTonTransaction> {
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

  try {
  const fromAddress = getAddressFromPrivateKey(privateKeyHex);

  // Get seqno
  const seqno = await getSeqno(fromAddress, network);

  // Build internal message (simplified)
  const internalMsg = new CellBuilder()
    .writeBit(false) // ihr_disabled
    .writeBit(true) // bounce
    .writeBit(false) // bounced
    .writeAddress(null) // src (will be filled by contract)
    .writeAddress(toAddress) // dest
    .writeCoins(amount) // value
    .writeBit(false) // ihr_fee
    .writeCoins(0n) // fwd_fee
    .writeUint(0, 64) // created_lt
    .writeUint(0, 32) // created_at
    .writeBit(false) // state_init
    .writeBit(message ? true : false); // body

  if (message) {
    // Add comment (0x00000000 prefix for text)
    const msgBytes = new TextEncoder().encode(message);
    internalMsg.writeUint(0, 32); // text comment opcode
    for (const byte of msgBytes) {
      internalMsg.writeUint(byte, 8);
    }
  }

  const internalMsgCell = internalMsg.build();

  // Build signing message
  const signingMsg = new CellBuilder()
    .writeUint(698983191, 32) // wallet v4 prefix
    .writeUint(Math.floor(Date.now() / 1000) + 60, 32) // valid_until
    .writeUint(seqno, 32) // seqno
    .writeUint(0, 8) // op (simple send)
    .writeUint(3, 8); // send_mode

  signingMsg.writeRef(internalMsgCell);

  const messageToSign = signingMsg.build();
  const messageHash = sha256(messageToSign);

  // Sign with Ed25519
  const signature = ed25519.sign(messageHash, signingKey);

  // Build external message with signature
  const externalMsg = new CellBuilder();
  for (let i = 0; i < 64; i++) {
    externalMsg.writeUint(signature[i], 8);
  }
  for (let i = 0; i < messageToSign.length; i++) {
    externalMsg.writeUint(messageToSign[i], 8);
  }

  const boc = base64Encode(externalMsg.build());
  const hash = bytesToHex(sha256(externalMsg.build()));

  return {
    boc,
    hash
  };
  } finally {
    privateKeyBytes.fill(0);
    signingKey.fill(0);
  }
}

/**
 * Sign and send a TON transaction
 */
export async function signAndSendTransaction(
  toAddress: string,
  amount: bigint,
  privateKeyHex: string,
  message?: string,
  network: TonNetwork = 'mainnet'
): Promise<{ hash: string; status: 'pending' | 'failed' }> {
  const signed = await signTransaction(toAddress, amount, privateKeyHex, message, network);
  const result = await sendBoc(signed.boc, network);

  return {
    hash: signed.hash,
    status: result.ok ? 'pending' : 'failed'
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

  try {
    const messageBytes = new TextEncoder().encode(message);
    const signature = ed25519.sign(messageBytes, signingKey);

    return bytesToHex(signature);
  } finally {
    privateKeyBytes.fill(0);
    signingKey.fill(0);
  }
}

/**
 * TON Transaction history item
 */
export interface TonTransactionHistory {
  hash: string;
  lt: string; // Logical time
  timestamp: number;
  type: 'send' | 'receive';
  amount: bigint; // in nanotons
  from: string;
  to: string;
  message: string | null;
  fee: bigint;
  status: 'confirmed';
}

/**
 * Get transaction history for a TON address
 * Uses TON HTTP API getTransactions endpoint
 */
export async function getTransactionHistory(
  address: string,
  network: TonNetwork = 'mainnet',
  limit: number = 20
): Promise<TonTransactionHistory[]> {
  try {
    const result = await apiCall(network, '/getTransactions', {
      address,
      limit
    });

    if (!result.ok || !result.result) {
      return [];
    }

    const transactions: TonTransactionHistory[] = [];

    for (const tx of result.result) {
      const parsed = parseTransaction(tx, address);
      if (parsed) {
        transactions.push(parsed);
      }
    }

    return transactions;
  } catch (err) {
    console.error('Failed to get TON transaction history:', err);
    return [];
  }
}

/**
 * Parse a TON transaction
 */
function parseTransaction(tx: any, walletAddress: string): TonTransactionHistory | null {
  try {
    const inMsg = tx.in_msg;
    const outMsgs = tx.out_msgs || [];

    // Determine if this is incoming or outgoing
    let type: 'send' | 'receive';
    let amount: bigint;
    let from: string;
    let to: string;
    let message: string | null = null;

    if (outMsgs.length > 0) {
      // Outgoing transaction
      type = 'send';
      const outMsg = outMsgs[0];
      amount = BigInt(outMsg.value || '0');
      from = walletAddress;
      to = outMsg.destination?.account_address || outMsg.destination || 'unknown';
      message = outMsg.message || null;
    } else if (inMsg && inMsg.source) {
      // Incoming transaction
      type = 'receive';
      amount = BigInt(inMsg.value || '0');
      from = inMsg.source?.account_address || inMsg.source || 'unknown';
      to = walletAddress;
      message = inMsg.message || null;
    } else {
      return null;
    }

    return {
      hash: tx.transaction_id?.hash || tx.hash || '',
      lt: tx.transaction_id?.lt || tx.lt || '0',
      timestamp: tx.utime || 0,
      type,
      amount,
      from,
      to,
      message,
      fee: BigInt(tx.fee || '0'),
      status: 'confirmed'
    };
  } catch (err) {
    console.error('Error parsing TON transaction:', err);
    return null;
  }
}
