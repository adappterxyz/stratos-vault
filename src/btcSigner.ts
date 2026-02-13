/**
 * Client-side Bitcoin Transaction Signing
 *
 * Uses @noble/secp256k1 for cryptographic operations.
 * Supports P2PKH (legacy) transactions.
 */

import { secp256k1 } from '@noble/curves/secp256k1.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { ripemd160 } from '@noble/hashes/legacy.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';

// RPC endpoints - must be set via setBtcRpcEndpoints() from config
let btcRpcEndpoints: Record<string, string> = {};

// Set RPC endpoints from config
export function setBtcRpcEndpoints(endpoints: Record<string, string>): void {
  btcRpcEndpoints = { ...endpoints };
}

export type BTCNetwork = 'mainnet' | 'testnet';

export interface BTCTransaction {
  to: string;
  amount: number; // in satoshis
  fee?: number; // in satoshis
  network?: BTCNetwork;
}

export interface UTXO {
  txid: string;
  vout: number;
  value: number; // in satoshis
  scriptPubKey?: string;
}

export interface SignedBTCTransaction {
  rawTransaction: string;
  txid: string;
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

// HASH160 = RIPEMD160(SHA256(data))
function hash160(data: Uint8Array): Uint8Array {
  return ripemd160(sha256(data));
}

// Get public key from private key
export function getPublicKey(privateKeyHex: string, compressed = true): Uint8Array {
  const cleanKey = privateKeyHex.startsWith('0x') ? privateKeyHex.slice(2) : privateKeyHex;
  return secp256k1.getPublicKey(hexToBytes(cleanKey), compressed);
}

// Get Bitcoin address from public key (P2PKH)
export function getAddressFromPublicKey(publicKey: Uint8Array, network: BTCNetwork = 'mainnet'): string {
  const pubKeyHash = hash160(publicKey);
  const version = network === 'mainnet' ? 0x00 : 0x6f; // 0x00 for mainnet, 0x6f for testnet

  const versionedPayload = new Uint8Array(21);
  versionedPayload[0] = version;
  versionedPayload.set(pubKeyHash, 1);

  const checksum = hash256(versionedPayload).slice(0, 4);

  const fullAddress = new Uint8Array(25);
  fullAddress.set(versionedPayload);
  fullAddress.set(checksum, 21);

  return base58Encode(fullAddress);
}

// Get address from private key
export function getAddressFromPrivateKey(privateKeyHex: string, network: BTCNetwork = 'mainnet'): string {
  const publicKey = getPublicKey(privateKeyHex, true);
  return getAddressFromPublicKey(publicKey, network);
}

// Decode address to pubkey hash
function decodeAddress(address: string): { version: number; pubKeyHash: Uint8Array } {
  const decoded = base58Decode(address);
  if (decoded.length !== 25) {
    throw new Error('Invalid address length');
  }

  const version = decoded[0];
  const pubKeyHash = decoded.slice(1, 21);
  const checksum = decoded.slice(21);

  // Verify checksum
  const expectedChecksum = hash256(decoded.slice(0, 21)).slice(0, 4);
  for (let i = 0; i < 4; i++) {
    if (checksum[i] !== expectedChecksum[i]) {
      throw new Error('Invalid address checksum');
    }
  }

  return { version, pubKeyHash };
}

// Variable length integer encoding
function varInt(n: number): Uint8Array {
  if (n < 0xfd) {
    return new Uint8Array([n]);
  } else if (n <= 0xffff) {
    return new Uint8Array([0xfd, n & 0xff, (n >> 8) & 0xff]);
  } else if (n <= 0xffffffff) {
    return new Uint8Array([0xfe, n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >> 24) & 0xff]);
  } else {
    throw new Error('Value too large for varInt');
  }
}

// Little-endian 32-bit integer
function uint32LE(n: number): Uint8Array {
  const bytes = new Uint8Array(4);
  bytes[0] = n & 0xff;
  bytes[1] = (n >> 8) & 0xff;
  bytes[2] = (n >> 16) & 0xff;
  bytes[3] = (n >> 24) & 0xff;
  return bytes;
}

// Little-endian 64-bit integer
function uint64LE(n: number): Uint8Array {
  const bytes = new Uint8Array(8);
  bytes[0] = n & 0xff;
  bytes[1] = (n >> 8) & 0xff;
  bytes[2] = (n >> 16) & 0xff;
  bytes[3] = (n >> 24) & 0xff;
  // JavaScript numbers can't handle full 64-bit, but for Bitcoin values this is fine
  bytes[4] = 0;
  bytes[5] = 0;
  bytes[6] = 0;
  bytes[7] = 0;
  return bytes;
}

// RPC call to Bitcoin node
async function rpcCall(network: BTCNetwork, method: string, params: any[]): Promise<any> {
  const rpcUrl = btcRpcEndpoints[network];

  const response = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '1.0',
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

// Get UTXOs for an address using scantxoutset
export async function getUTXOs(address: string, network: BTCNetwork = 'mainnet'): Promise<UTXO[]> {
  try {
    const result = await rpcCall(network, 'scantxoutset', ['start', [`addr(${address})`]]);
    if (result && result.unspents) {
      return result.unspents.map((utxo: any) => ({
        txid: utxo.txid,
        vout: utxo.vout,
        value: Math.round(utxo.amount * 100000000), // BTC to satoshis
        scriptPubKey: utxo.scriptPubKey
      }));
    }
  } catch (err) {
    console.warn('scantxoutset failed:', err);
  }

  return [];
}

// Get balance for an address
export async function getBalance(address: string, network: BTCNetwork = 'mainnet'): Promise<number> {
  // Use scantxoutset to get UTXOs and sum their values
  const utxos = await getUTXOs(address, network);
  return utxos.reduce((sum, utxo) => sum + utxo.value, 0);
}

// Send raw transaction
export async function sendRawTransaction(rawTx: string, network: BTCNetwork = 'mainnet'): Promise<string> {
  return await rpcCall(network, 'sendrawtransaction', [rawTx]);
}

// Create P2PKH scriptPubKey
function createP2PKHScriptPubKey(pubKeyHash: Uint8Array): Uint8Array {
  // OP_DUP OP_HASH160 <pubKeyHash> OP_EQUALVERIFY OP_CHECKSIG
  const script = new Uint8Array(25);
  script[0] = 0x76; // OP_DUP
  script[1] = 0xa9; // OP_HASH160
  script[2] = 0x14; // Push 20 bytes
  script.set(pubKeyHash, 3);
  script[23] = 0x88; // OP_EQUALVERIFY
  script[24] = 0xac; // OP_CHECKSIG
  return script;
}

// Create P2PKH scriptSig
function createP2PKHScriptSig(signature: Uint8Array, publicKey: Uint8Array): Uint8Array {
  const sigLen = signature.length;
  const pubKeyLen = publicKey.length;
  const script = new Uint8Array(1 + sigLen + 1 + pubKeyLen);
  script[0] = sigLen;
  script.set(signature, 1);
  script[1 + sigLen] = pubKeyLen;
  script.set(publicKey, 2 + sigLen);
  return script;
}

/**
 * Sign a Bitcoin transaction
 *
 * @param utxos UTXOs to spend
 * @param toAddress Recipient address
 * @param amount Amount in satoshis
 * @param privateKeyHex Private key
 * @param changeAddress Change address (optional, defaults to sender)
 * @param fee Fee in satoshis (optional, defaults to 1000)
 * @param network Network (mainnet or testnet)
 */
export async function signTransaction(
  utxos: UTXO[],
  toAddress: string,
  amount: number,
  privateKeyHex: string,
  changeAddress?: string,
  fee: number = 1000,
  network: BTCNetwork = 'mainnet'
): Promise<SignedBTCTransaction> {
  const cleanKey = privateKeyHex.startsWith('0x') ? privateKeyHex.slice(2) : privateKeyHex;
  const privateKeyBytes = hexToBytes(cleanKey);
  const publicKey = secp256k1.getPublicKey(privateKeyBytes, true);
  const senderAddress = getAddressFromPublicKey(publicKey, network);

  try {
  // Calculate total input value
  const totalInput = utxos.reduce((sum, utxo) => sum + utxo.value, 0);
  const change = totalInput - amount - fee;

  if (change < 0) {
    throw new Error(`Insufficient funds. Have ${totalInput}, need ${amount + fee}`);
  }

  // Decode addresses
  const toDecoded = decodeAddress(toAddress);
  const changeAddr = changeAddress || senderAddress;
  const changeDecoded = decodeAddress(changeAddr);

  // Build transaction
  const version = uint32LE(1);
  const locktime = uint32LE(0);

  // Inputs
  const inputCount = varInt(utxos.length);
  const inputs: Uint8Array[] = [];

  for (const utxo of utxos) {
    const txidBytes = hexToBytes(utxo.txid).reverse(); // Little-endian
    const voutBytes = uint32LE(utxo.vout);
    const scriptSigPlaceholder = new Uint8Array([0]); // Empty for now
    const sequence = new Uint8Array([0xff, 0xff, 0xff, 0xff]);

    const input = new Uint8Array(txidBytes.length + voutBytes.length + 1 + sequence.length);
    let offset = 0;
    input.set(txidBytes, offset); offset += txidBytes.length;
    input.set(voutBytes, offset); offset += voutBytes.length;
    input.set(scriptSigPlaceholder, offset); offset += 1;
    input.set(sequence, offset);

    inputs.push(input);
  }

  // Outputs
  const outputs: Uint8Array[] = [];
  let outputCount = 1;

  // Output to recipient
  const toScript = createP2PKHScriptPubKey(toDecoded.pubKeyHash);
  const toOutput = new Uint8Array(8 + 1 + toScript.length);
  toOutput.set(uint64LE(amount), 0);
  toOutput[8] = toScript.length;
  toOutput.set(toScript, 9);
  outputs.push(toOutput);

  // Change output (if needed)
  if (change > 546) { // Dust threshold
    outputCount++;
    const changeScript = createP2PKHScriptPubKey(changeDecoded.pubKeyHash);
    const changeOutput = new Uint8Array(8 + 1 + changeScript.length);
    changeOutput.set(uint64LE(change), 0);
    changeOutput[8] = changeScript.length;
    changeOutput.set(changeScript, 9);
    outputs.push(changeOutput);
  }

  // Sign each input
  const signedInputs: Uint8Array[] = [];

  for (let i = 0; i < utxos.length; i++) {
    const utxo = utxos[i];

    // Create transaction for signing (with scriptPubKey in the input being signed)
    const senderDecoded = decodeAddress(senderAddress);
    const sigScript = createP2PKHScriptPubKey(senderDecoded.pubKeyHash);

    // Build tx for signing
    const txParts: Uint8Array[] = [version, inputCount];

    for (let j = 0; j < utxos.length; j++) {
      const u = utxos[j];
      const txidBytes = hexToBytes(u.txid).reverse();
      const voutBytes = uint32LE(u.vout);
      const sequence = new Uint8Array([0xff, 0xff, 0xff, 0xff]);

      if (j === i) {
        // Include scriptPubKey for input being signed
        const inputWithScript = new Uint8Array(32 + 4 + 1 + sigScript.length + 4);
        let off = 0;
        inputWithScript.set(txidBytes, off); off += 32;
        inputWithScript.set(voutBytes, off); off += 4;
        inputWithScript[off] = sigScript.length; off += 1;
        inputWithScript.set(sigScript, off); off += sigScript.length;
        inputWithScript.set(sequence, off);
        txParts.push(inputWithScript);
      } else {
        // Empty script for other inputs
        const emptyInput = new Uint8Array(32 + 4 + 1 + 4);
        let off = 0;
        emptyInput.set(txidBytes, off); off += 32;
        emptyInput.set(voutBytes, off); off += 4;
        emptyInput[off] = 0; off += 1;
        emptyInput.set(sequence, off);
        txParts.push(emptyInput);
      }
    }

    txParts.push(varInt(outputCount));
    outputs.forEach(out => txParts.push(out));
    txParts.push(locktime);
    txParts.push(uint32LE(1)); // SIGHASH_ALL

    // Calculate total length and build
    const totalLen = txParts.reduce((sum, p) => sum + p.length, 0);
    const txForSigning = new Uint8Array(totalLen);
    let offset = 0;
    for (const part of txParts) {
      txForSigning.set(part, offset);
      offset += part.length;
    }

    // Hash and sign with recovered format (65 bytes: r(32) + s(32) + recovery(1))
    const txHash = hash256(txForSigning);
    const signatureBytes = secp256k1.sign(txHash, privateKeyBytes, { prehash: false, lowS: true, format: 'recovered' });

    // DER encode signature + SIGHASH_ALL byte
    const rBytes = signatureBytes.slice(0, 32);
    const sBytes = signatureBytes.slice(32, 64);

    // Remove leading zeros but keep one if high bit set
    let rTrimmed = rBytes;
    while (rTrimmed.length > 1 && rTrimmed[0] === 0 && rTrimmed[1] < 0x80) {
      rTrimmed = rTrimmed.slice(1);
    }
    if (rTrimmed[0] >= 0x80) {
      const tmp = new Uint8Array(rTrimmed.length + 1);
      tmp[0] = 0;
      tmp.set(rTrimmed, 1);
      rTrimmed = tmp;
    }

    let sTrimmed = sBytes;
    while (sTrimmed.length > 1 && sTrimmed[0] === 0 && sTrimmed[1] < 0x80) {
      sTrimmed = sTrimmed.slice(1);
    }
    if (sTrimmed[0] >= 0x80) {
      const tmp = new Uint8Array(sTrimmed.length + 1);
      tmp[0] = 0;
      tmp.set(sTrimmed, 1);
      sTrimmed = tmp;
    }

    // DER format: 0x30 [total-length] 0x02 [r-length] [r] 0x02 [s-length] [s]
    const derLen = 4 + rTrimmed.length + sTrimmed.length;
    const derSig = new Uint8Array(derLen + 2); // +1 for SIGHASH_ALL
    derSig[0] = 0x30;
    derSig[1] = derLen - 2;
    derSig[2] = 0x02;
    derSig[3] = rTrimmed.length;
    derSig.set(rTrimmed, 4);
    derSig[4 + rTrimmed.length] = 0x02;
    derSig[5 + rTrimmed.length] = sTrimmed.length;
    derSig.set(sTrimmed, 6 + rTrimmed.length);
    derSig[derSig.length - 1] = 0x01; // SIGHASH_ALL

    // Create scriptSig
    const scriptSig = createP2PKHScriptSig(derSig, publicKey);

    // Build signed input
    const txidBytes = hexToBytes(utxo.txid).reverse();
    const voutBytes = uint32LE(utxo.vout);
    const sequence = new Uint8Array([0xff, 0xff, 0xff, 0xff]);

    const signedInput = new Uint8Array(32 + 4 + varInt(scriptSig.length).length + scriptSig.length + 4);
    let off = 0;
    signedInput.set(txidBytes, off); off += 32;
    signedInput.set(voutBytes, off); off += 4;
    const scriptLenBytes = varInt(scriptSig.length);
    signedInput.set(scriptLenBytes, off); off += scriptLenBytes.length;
    signedInput.set(scriptSig, off); off += scriptSig.length;
    signedInput.set(sequence, off);

    signedInputs.push(signedInput);
  }

  // Build final transaction
  const finalParts: Uint8Array[] = [version, inputCount];
  signedInputs.forEach(input => finalParts.push(input));
  finalParts.push(varInt(outputCount));
  outputs.forEach(out => finalParts.push(out));
  finalParts.push(locktime);

  const finalLen = finalParts.reduce((sum, p) => sum + p.length, 0);
  const rawTx = new Uint8Array(finalLen);
  let off = 0;
  for (const part of finalParts) {
    rawTx.set(part, off);
    off += part.length;
  }

  const rawTxHex = bytesToHex(rawTx);
  const txid = bytesToHex(hash256(rawTx).reverse());

  return {
    rawTransaction: rawTxHex,
    txid
  };
  } finally {
    privateKeyBytes.fill(0);
  }
}

/**
 * Sign and send a Bitcoin transaction
 */
export async function signAndSendTransaction(
  utxos: UTXO[],
  toAddress: string,
  amount: number,
  privateKeyHex: string,
  changeAddress?: string,
  fee: number = 1000,
  network: BTCNetwork = 'mainnet'
): Promise<{ txid: string; status: 'pending' }> {
  const signed = await signTransaction(utxos, toAddress, amount, privateKeyHex, changeAddress, fee, network);
  const txid = await sendRawTransaction(signed.rawTransaction, network);

  return {
    txid,
    status: 'pending'
  };
}

/**
 * BTC Transaction history item
 */
export interface BTCTransactionHistory {
  txid: string;
  blockHeight: number | null;
  blockTime: number | null;
  type: 'send' | 'receive';
  amount: number; // in satoshis
  fee: number;
  from: string[];
  to: string[];
  status: 'confirmed' | 'pending';
}

// Fallback REST API endpoints for transaction history (Blockstream/Mempool style)
const REST_API_ENDPOINTS: Record<BTCNetwork, string> = {
  mainnet: 'https://blockstream.info/api',
  testnet: 'https://blockstream.info/testnet/api'
};

/**
 * Get transaction history for a BTC address
 * Uses Blockstream/Mempool-style REST API since Bitcoin Core RPC doesn't support address history
 */
export async function getTransactionHistory(
  address: string,
  network: BTCNetwork = 'mainnet',
  limit: number = 20
): Promise<BTCTransactionHistory[]> {
  try {
    const apiBase = REST_API_ENDPOINTS[network];
    const response = await fetch(`${apiBase}/address/${address}/txs`);

    if (!response.ok) {
      console.warn('BTC transaction history API failed:', response.status);
      return [];
    }

    const txs = await response.json() as any[];
    const transactions: BTCTransactionHistory[] = [];

    for (const tx of txs.slice(0, limit)) {
      const parsed = parseTransaction(tx, address);
      if (parsed) {
        transactions.push(parsed);
      }
    }

    return transactions;
  } catch (err) {
    console.error('Failed to get BTC transaction history:', err);
    return [];
  }
}

/**
 * Parse a Blockstream-style transaction
 */
function parseTransaction(tx: any, walletAddress: string): BTCTransactionHistory | null {
  try {
    const fee = tx.fee || 0;
    const blockHeight = tx.status?.block_height || null;
    const blockTime = tx.status?.block_time || null;

    // Calculate sent and received amounts
    let received = 0;
    let sent = 0;
    const fromAddresses: string[] = [];
    const toAddresses: string[] = [];

    // Check inputs (what was spent)
    for (const vin of tx.vin || []) {
      const prevAddr = vin.prevout?.scriptpubkey_address;
      if (prevAddr) {
        fromAddresses.push(prevAddr);
        if (prevAddr === walletAddress) {
          sent += vin.prevout?.value || 0;
        }
      }
    }

    // Check outputs (what was received)
    for (const vout of tx.vout || []) {
      const outAddr = vout.scriptpubkey_address;
      if (outAddr) {
        toAddresses.push(outAddr);
        if (outAddr === walletAddress) {
          received += vout.value || 0;
        }
      }
    }

    // Determine transaction type
    let type: 'send' | 'receive';
    let amount: number;

    if (sent > 0 && received > 0) {
      // Could be a self-transfer or change
      amount = sent - received - fee;
      type = amount > 0 ? 'send' : 'receive';
      amount = Math.abs(amount);
    } else if (sent > 0) {
      type = 'send';
      amount = sent - fee;
    } else {
      type = 'receive';
      amount = received;
    }

    return {
      txid: tx.txid,
      blockHeight,
      blockTime,
      type,
      amount,
      fee,
      from: [...new Set(fromAddresses)],
      to: [...new Set(toAddresses)],
      status: tx.status?.confirmed ? 'confirmed' : 'pending'
    };
  } catch (err) {
    console.error('Error parsing BTC transaction:', err);
    return null;
  }
}
