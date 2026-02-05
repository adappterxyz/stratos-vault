/**
 * Client-side EVM Transaction Signing
 *
 * Uses @noble/secp256k1 and @noble/hashes for cryptographic operations.
 * Decrypts private key using WebAuthn PRF output.
 */

import { secp256k1 } from '@noble/curves/secp256k1.js';
import { keccak_256 } from '@noble/hashes/sha3.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';

// RPC endpoints - must be set via setEvmRpcEndpoints() from config
let rpcEndpoints: Record<number, string> = {};

// Set RPC endpoints from config
export function setEvmRpcEndpoints(endpoints: Record<number | string, string>): void {
  // Convert string keys to numbers
  const converted: Record<number, string> = {};
  for (const [key, value] of Object.entries(endpoints)) {
    converted[Number(key)] = value;
  }
  rpcEndpoints = converted;
}

export interface EVMTransaction {
  to: string;
  value?: string;
  data?: string;
  gasLimit?: string;
  gasPrice?: string;
  maxFeePerGas?: string;
  maxPriorityFeePerGas?: string;
  nonce?: number | string;
  chainId: number;
}

export interface SignedTransaction {
  rawTransaction: string;
  transactionHash: string;
}

// RLP Encoding
function rlpEncode(input: any): Uint8Array {
  if (typeof input === 'string') {
    if (input.startsWith('0x')) {
      const bytes = hexToBytes(input.slice(2));
      // Remove leading zeros for RLP
      let i = 0;
      while (i < bytes.length - 1 && bytes[i] === 0) i++;
      return rlpEncodeBytes(bytes.slice(i));
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
    const encoded = input.map(item => rlpEncode(item));
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
  // Empty or null
  return new Uint8Array([0x80]);
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

// Hex utilities
export function toHex(value: number | bigint | string | undefined, defaultValue = '0x0'): string {
  if (value === undefined || value === null || value === '') return defaultValue;
  if (typeof value === 'string') {
    if (value.startsWith('0x')) return value;
    return '0x' + BigInt(value).toString(16);
  }
  return '0x' + value.toString(16);
}

function parseHex(value: string): Uint8Array {
  if (!value || value === '0x' || value === '0x0') {
    return new Uint8Array(0);
  }
  const cleanHex = value.startsWith('0x') ? value.slice(2) : value;
  if (cleanHex.length === 0) return new Uint8Array(0);
  // Ensure even length
  const padded = cleanHex.length % 2 ? '0' + cleanHex : cleanHex;
  return hexToBytes(padded);
}

// RPC Call
async function rpcCall(chainId: number, method: string, params: any[]): Promise<any> {
  const rpcUrl = rpcEndpoints[chainId];
  if (!rpcUrl) {
    throw new Error(`Unsupported chain ID: ${chainId}. Available chains: ${Object.keys(rpcEndpoints).join(', ')}`);
  }

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

// Get transaction count (nonce)
export async function getNonce(chainId: number, address: string): Promise<number> {
  const result = await rpcCall(chainId, 'eth_getTransactionCount', [address, 'pending']);
  return parseInt(result, 16);
}

// Get gas price
export async function getGasPrice(chainId: number): Promise<string> {
  return await rpcCall(chainId, 'eth_gasPrice', []);
}

// Estimate gas
export async function estimateGas(chainId: number, tx: { from: string; to: string; value?: string; data?: string }): Promise<string> {
  try {
    const gasHex = await rpcCall(chainId, 'eth_estimateGas', [tx]);
    // Add 20% buffer
    const gas = parseInt(gasHex, 16);
    return '0x' + Math.ceil(gas * 1.2).toString(16);
  } catch {
    return '0x5208'; // Default 21000 for simple transfer
  }
}

// Get fee data (for EIP-1559)
export async function getFeeData(chainId: number): Promise<{ maxFeePerGas: string; maxPriorityFeePerGas: string }> {
  try {
    const [baseFee, priorityFee] = await Promise.all([
      rpcCall(chainId, 'eth_gasPrice', []),
      rpcCall(chainId, 'eth_maxPriorityFeePerGas', []).catch(() => '0x3b9aca00') // Default 1 gwei
    ]);

    const baseFeeNum = parseInt(baseFee, 16);
    const priorityFeeNum = parseInt(priorityFee, 16);

    // maxFeePerGas = 2 * baseFee + priorityFee
    const maxFeePerGas = '0x' + (baseFeeNum * 2 + priorityFeeNum).toString(16);

    return {
      maxFeePerGas,
      maxPriorityFeePerGas: priorityFee
    };
  } catch {
    return {
      maxFeePerGas: '0x3b9aca00', // 1 gwei
      maxPriorityFeePerGas: '0x3b9aca00'
    };
  }
}

// Send raw transaction
export async function sendRawTransaction(chainId: number, signedTx: string): Promise<string> {
  return await rpcCall(chainId, 'eth_sendRawTransaction', [signedTx]);
}

// Get transaction receipt
export async function getTransactionReceipt(chainId: number, txHash: string): Promise<any> {
  return await rpcCall(chainId, 'eth_getTransactionReceipt', [txHash]);
}

// Get balance in wei
export async function getBalance(address: string, chainId: number = 1): Promise<bigint> {
  try {
    const result = await rpcCall(chainId, 'eth_getBalance', [address, 'latest']);
    return BigInt(result);
  } catch {
    return 0n;
  }
}

// Get ERC20 token balance
export async function getTokenBalance(tokenAddress: string, walletAddress: string, chainId: number = 1): Promise<bigint> {
  try {
    // balanceOf(address) selector = 0x70a08231
    const data = '0x70a08231' + walletAddress.slice(2).padStart(64, '0');
    const result = await rpcCall(chainId, 'eth_call', [
      { to: tokenAddress, data },
      'latest'
    ]);
    return BigInt(result);
  } catch {
    return 0n;
  }
}

/**
 * Sign an EVM transaction
 *
 * @param tx Transaction parameters
 * @param privateKeyHex Private key as hex string (with or without 0x prefix)
 * @param fromAddress Sender address (for nonce lookup)
 * @returns Signed transaction
 */
export async function signTransaction(
  tx: EVMTransaction,
  privateKeyHex: string,
  fromAddress: string
): Promise<SignedTransaction> {
  // Clean private key
  const cleanPrivateKey = privateKeyHex.startsWith('0x') ? privateKeyHex.slice(2) : privateKeyHex;
  const privateKeyBytes = hexToBytes(cleanPrivateKey);

  // Get nonce if not provided
  let nonce = tx.nonce;
  if (nonce === undefined) {
    nonce = await getNonce(tx.chainId, fromAddress);
  }
  if (typeof nonce === 'string') {
    nonce = parseInt(nonce, 16);
  }

  // Determine if EIP-1559 or legacy
  const isEIP1559 = tx.maxFeePerGas !== undefined || (tx.gasPrice === undefined && tx.chainId !== 56); // BSC doesn't support EIP-1559

  let gasPrice = tx.gasPrice;
  let maxFeePerGas = tx.maxFeePerGas;
  let maxPriorityFeePerGas = tx.maxPriorityFeePerGas;

  if (isEIP1559 && !maxFeePerGas) {
    const feeData = await getFeeData(tx.chainId);
    maxFeePerGas = feeData.maxFeePerGas;
    maxPriorityFeePerGas = feeData.maxPriorityFeePerGas;
  } else if (!isEIP1559 && !gasPrice) {
    gasPrice = await getGasPrice(tx.chainId);
  }

  // Get gas limit if not provided
  let gasLimit = tx.gasLimit;
  if (!gasLimit) {
    gasLimit = await estimateGas(tx.chainId, {
      from: fromAddress,
      to: tx.to,
      value: tx.value || '0x0',
      data: tx.data || '0x'
    });
  }

  let rawTransaction: string;
  let messageHash: Uint8Array;

  if (isEIP1559) {
    // EIP-1559 transaction (Type 2)
    const txData = [
      tx.chainId,
      nonce,
      parseHex(maxPriorityFeePerGas || '0x0'),
      parseHex(maxFeePerGas || '0x0'),
      parseHex(gasLimit),
      parseHex(tx.to),
      parseHex(tx.value || '0x0'),
      parseHex(tx.data || '0x'),
      [] // Access list (empty)
    ];

    // Encode for signing
    const encodedForSigning = rlpEncode(txData);
    const toSign = new Uint8Array(1 + encodedForSigning.length);
    toSign[0] = 0x02; // EIP-1559 type
    toSign.set(encodedForSigning, 1);

    messageHash = keccak_256(toSign);

    // Sign with recovered format (65 bytes: r(32) + s(32) + v(1))
    const signatureBytes = secp256k1.sign(messageHash, privateKeyBytes, { prehash: false, format: 'recovered' });
    const r = signatureBytes.slice(0, 32);
    const s = signatureBytes.slice(32, 64);
    const v = signatureBytes[64];

    // Build signed transaction
    const signedTxData = [
      tx.chainId,
      nonce,
      parseHex(maxPriorityFeePerGas || '0x0'),
      parseHex(maxFeePerGas || '0x0'),
      parseHex(gasLimit),
      parseHex(tx.to),
      parseHex(tx.value || '0x0'),
      parseHex(tx.data || '0x'),
      [], // Access list
      v,
      r,
      s
    ];

    const encodedSigned = rlpEncode(signedTxData);
    const finalTx = new Uint8Array(1 + encodedSigned.length);
    finalTx[0] = 0x02;
    finalTx.set(encodedSigned, 1);

    rawTransaction = '0x' + bytesToHex(finalTx);
  } else {
    // Legacy transaction
    const txData = [
      nonce,
      parseHex(gasPrice || '0x0'),
      parseHex(gasLimit),
      parseHex(tx.to),
      parseHex(tx.value || '0x0'),
      parseHex(tx.data || '0x'),
      tx.chainId,
      0,
      0
    ];

    // Encode for signing (EIP-155)
    const encodedForSigning = rlpEncode(txData);
    messageHash = keccak_256(encodedForSigning);

    // Sign with recovered format (65 bytes: r(32) + s(32) + recovery(1))
    const signatureBytes = secp256k1.sign(messageHash, privateKeyBytes, { prehash: false, format: 'recovered' });
    const r = signatureBytes.slice(0, 32);
    const s = signatureBytes.slice(32, 64);
    const recovery = signatureBytes[64];
    // EIP-155: v = chainId * 2 + 35 + recovery
    const v = tx.chainId * 2 + 35 + recovery;

    // Build signed transaction
    const signedTxData = [
      nonce,
      parseHex(gasPrice || '0x0'),
      parseHex(gasLimit),
      parseHex(tx.to),
      parseHex(tx.value || '0x0'),
      parseHex(tx.data || '0x'),
      v,
      r,
      s
    ];

    const encodedSigned = rlpEncode(signedTxData);
    rawTransaction = '0x' + bytesToHex(encodedSigned);
  }

  // Calculate transaction hash
  const transactionHash = '0x' + bytesToHex(keccak_256(hexToBytes(rawTransaction.slice(2))));

  return {
    rawTransaction,
    transactionHash
  };
}

/**
 * Sign and send an EVM transaction
 */
export async function signAndSendTransaction(
  tx: EVMTransaction,
  privateKeyHex: string,
  fromAddress: string
): Promise<{ transactionHash: string; status: 'pending' }> {
  const signed = await signTransaction(tx, privateKeyHex, fromAddress);
  const txHash = await sendRawTransaction(tx.chainId, signed.rawTransaction);

  return {
    transactionHash: txHash,
    status: 'pending'
  };
}

/**
 * Sign a message (personal_sign / eth_sign)
 */
export function signMessage(message: string, privateKeyHex: string): string {
  const cleanPrivateKey = privateKeyHex.startsWith('0x') ? privateKeyHex.slice(2) : privateKeyHex;
  const privateKeyBytes = hexToBytes(cleanPrivateKey);

  // Ethereum signed message prefix
  const prefix = '\x19Ethereum Signed Message:\n' + message.length;
  const prefixedMessage = new TextEncoder().encode(prefix + message);
  const messageHash = keccak_256(prefixedMessage);

  // Sign with recovered format (65 bytes: r(32) + s(32) + recovery(1))
  const signatureBytes = secp256k1.sign(messageHash, privateKeyBytes, { prehash: false, format: 'recovered' });
  const r = bytesToHex(signatureBytes.slice(0, 32));
  const s = bytesToHex(signatureBytes.slice(32, 64));
  const v = (signatureBytes[64] + 27).toString(16).padStart(2, '0');

  return '0x' + r + s + v;
}

/**
 * Sign EIP-712 typed data
 */
export function signTypedData(
  typedData: {
    types: Record<string, Array<{ name: string; type: string }>>;
    primaryType: string;
    domain: Record<string, any>;
    message: Record<string, any>;
  },
  privateKeyHex: string
): string {
  const cleanPrivateKey = privateKeyHex.startsWith('0x') ? privateKeyHex.slice(2) : privateKeyHex;
  const privateKeyBytes = hexToBytes(cleanPrivateKey);

  // EIP-712 hash calculation (simplified - full implementation needs type encoding)
  // This is a placeholder - proper EIP-712 requires encoding each type
  const domainSeparator = keccak_256(new TextEncoder().encode(JSON.stringify(typedData.domain)));
  const structHash = keccak_256(new TextEncoder().encode(JSON.stringify(typedData.message)));

  // Combine: \x19\x01 + domainSeparator + structHash
  const combined = new Uint8Array(2 + 32 + 32);
  combined[0] = 0x19;
  combined[1] = 0x01;
  combined.set(domainSeparator, 2);
  combined.set(structHash, 34);

  const messageHash = keccak_256(combined);

  // Sign with recovered format (65 bytes: r(32) + s(32) + recovery(1))
  const signatureBytes = secp256k1.sign(messageHash, privateKeyBytes, { prehash: false, format: 'recovered' });
  const r = bytesToHex(signatureBytes.slice(0, 32));
  const s = bytesToHex(signatureBytes.slice(32, 64));
  const v = (signatureBytes[64] + 27).toString(16).padStart(2, '0');

  return '0x' + r + s + v;
}

/**
 * Get address from private key
 */
export function getAddressFromPrivateKey(privateKeyHex: string): string {
  const cleanPrivateKey = privateKeyHex.startsWith('0x') ? privateKeyHex.slice(2) : privateKeyHex;
  const privateKeyBytes = hexToBytes(cleanPrivateKey);

  const publicKey = secp256k1.getPublicKey(privateKeyBytes, false);
  // Remove the 0x04 prefix (uncompressed key marker)
  const publicKeyWithoutPrefix = publicKey.slice(1);

  const addressHash = keccak_256(publicKeyWithoutPrefix);
  const address = '0x' + bytesToHex(addressHash.slice(-20));

  return address;
}

/**
 * EVM Transaction history item
 */
export interface EVMTransactionHistory {
  txHash: string;
  blockNumber: number;
  timestamp: number | null;
  type: 'send' | 'receive';
  amount: string; // in wei or token units
  from: string;
  to: string;
  tokenAddress: string | null; // null for native ETH
  tokenSymbol: string | null;
  status: 'confirmed';
}

// ERC20 Transfer event topic: keccak256("Transfer(address,address,uint256)")
const TRANSFER_EVENT_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

/**
 * Get ERC20 token transfer history for an address using eth_getLogs
 * Note: Native ETH transfers cannot be tracked via standard RPC
 */
export async function getTransactionHistory(
  address: string,
  chainId: number,
  options: {
    fromBlock?: string;
    toBlock?: string;
    tokenAddresses?: string[]; // Filter by specific tokens
  } = {}
): Promise<EVMTransactionHistory[]> {
  const { fromBlock = 'earliest', toBlock = 'latest', tokenAddresses } = options;

  try {
    const paddedAddress = '0x' + address.slice(2).toLowerCase().padStart(64, '0');
    const transactions: EVMTransactionHistory[] = [];

    // Get transfers TO this address (received)
    const receivedLogs = await rpcCall(chainId, 'eth_getLogs', [{
      fromBlock,
      toBlock,
      topics: [
        TRANSFER_EVENT_TOPIC,
        null, // from (any)
        paddedAddress // to (this address)
      ],
      ...(tokenAddresses ? { address: tokenAddresses } : {})
    }]);

    for (const log of receivedLogs || []) {
      const tx = parseTransferLog(log, address, 'receive');
      if (tx) transactions.push(tx);
    }

    // Get transfers FROM this address (sent)
    const sentLogs = await rpcCall(chainId, 'eth_getLogs', [{
      fromBlock,
      toBlock,
      topics: [
        TRANSFER_EVENT_TOPIC,
        paddedAddress, // from (this address)
        null // to (any)
      ],
      ...(tokenAddresses ? { address: tokenAddresses } : {})
    }]);

    for (const log of sentLogs || []) {
      const tx = parseTransferLog(log, address, 'send');
      if (tx) transactions.push(tx);
    }

    // Sort by block number descending
    transactions.sort((a, b) => b.blockNumber - a.blockNumber);

    return transactions;
  } catch (err) {
    console.error('Failed to get EVM transaction history:', err);
    return [];
  }
}

/**
 * Parse a Transfer event log into a transaction history item
 */
function parseTransferLog(log: any, _walletAddress: string, type: 'send' | 'receive'): EVMTransactionHistory | null {
  try {
    const from = '0x' + log.topics[1].slice(26).toLowerCase();
    const to = '0x' + log.topics[2].slice(26).toLowerCase();
    const amount = BigInt(log.data).toString();

    return {
      txHash: log.transactionHash,
      blockNumber: parseInt(log.blockNumber, 16),
      timestamp: null, // Would need eth_getBlockByNumber to get timestamp
      type,
      amount,
      from,
      to,
      tokenAddress: log.address,
      tokenSymbol: null, // Would need token contract call to get symbol
      status: 'confirmed'
    };
  } catch (err) {
    console.error('Error parsing transfer log:', err);
    return null;
  }
}

/**
 * Get block timestamp (for enriching transaction history)
 */
export async function getBlockTimestamp(chainId: number, blockNumber: number): Promise<number | null> {
  try {
    const block = await rpcCall(chainId, 'eth_getBlockByNumber', [
      '0x' + blockNumber.toString(16),
      false
    ]);
    return block?.timestamp ? parseInt(block.timestamp, 16) : null;
  } catch {
    return null;
  }
}
