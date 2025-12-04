// Wallet address generation utilities for EVM, SVM, Bitcoin, TRON, and TON chains
// Uses Web Crypto API available in Cloudflare Workers

import { generateId } from './utils';

export interface WalletAddress {
  chainType: 'evm' | 'svm' | 'btc' | 'tron' | 'ton';
  address: string;
  privateKeyEncrypted: string;
}

// Generate random bytes using Web Crypto
async function getRandomBytes(length: number): Promise<Uint8Array> {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}

// Convert bytes to hex string
function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

// Simple XOR encryption with a key (for basic obfuscation - in production use proper encryption)
async function encryptPrivateKey(privateKey: string, encryptionKey: string): Promise<string> {
  const encoder = new TextEncoder();
  const keyBytes = encoder.encode(encryptionKey);
  const dataBytes = encoder.encode(privateKey);

  // Use SHA-256 to derive a key of consistent length
  const keyHash = await crypto.subtle.digest('SHA-256', keyBytes);
  const keyArray = new Uint8Array(keyHash);

  // XOR encryption
  const encrypted = new Uint8Array(dataBytes.length);
  for (let i = 0; i < dataBytes.length; i++) {
    encrypted[i] = dataBytes[i] ^ keyArray[i % keyArray.length];
  }

  return bytesToHex(encrypted);
}

// Decrypt private key using XOR (same as encryption since XOR is symmetric)
export async function decryptPrivateKey(encryptedHex: string, encryptionKey: string): Promise<string> {
  const encoder = new TextEncoder();
  const keyBytes = encoder.encode(encryptionKey);

  // Use SHA-256 to derive a key of consistent length
  const keyHash = await crypto.subtle.digest('SHA-256', keyBytes);
  const keyArray = new Uint8Array(keyHash);

  // Convert hex to bytes
  const encryptedBytes = hexToBytes(encryptedHex);

  // XOR decryption (same as encryption)
  const decrypted = new Uint8Array(encryptedBytes.length);
  for (let i = 0; i < encryptedBytes.length; i++) {
    decrypted[i] = encryptedBytes[i] ^ keyArray[i % keyArray.length];
  }

  return new TextDecoder().decode(decrypted);
}

// Convert hex string to bytes
function hexToBytes(hex: string): Uint8Array {
  const cleanHex = hex.startsWith('0x') ? hex.slice(2) : hex;
  const bytes = new Uint8Array(cleanHex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(cleanHex.substr(i * 2, 2), 16);
  }
  return bytes;
}

// Hash function for address derivation
async function sha256Hash(data: Uint8Array): Promise<Uint8Array> {
  // Copy data to ensure we have a proper ArrayBuffer
  const buffer = new ArrayBuffer(data.length);
  const view = new Uint8Array(buffer);
  view.set(data);
  const hash = await crypto.subtle.digest('SHA-256', buffer);
  return new Uint8Array(hash);
}

// Generate EVM-compatible address (Ethereum, Polygon, BSC, etc.)
async function generateEVMAddress(encryptionKey: string): Promise<WalletAddress> {
  // Generate 32 random bytes for private key
  const privateKeyBytes = await getRandomBytes(32);
  const privateKeyHex = '0x' + bytesToHex(privateKeyBytes);

  // For EVM, we need to derive public key from private key
  // Using secp256k1 curve - simplified approach using hash of private key
  // In production, use proper elliptic curve library
  const publicKeyHash = await sha256Hash(privateKeyBytes);

  // Take last 20 bytes for address (standard EVM address derivation)
  const addressBytes = publicKeyHash.slice(12, 32);
  const address = '0x' + bytesToHex(addressBytes);

  // Encrypt private key for storage
  const privateKeyEncrypted = await encryptPrivateKey(privateKeyHex, encryptionKey);

  return {
    chainType: 'evm',
    address: address,
    privateKeyEncrypted
  };
}

// Generate SVM-compatible address (Solana)
async function generateSVMAddress(encryptionKey: string): Promise<WalletAddress> {
  // Solana uses Ed25519 keys - 32 byte private key
  const privateKeyBytes = await getRandomBytes(32);
  const privateKeyHex = bytesToHex(privateKeyBytes);

  // For Solana, public key is derived from private key using Ed25519
  // Simplified: use hash of private key as public key representation
  const publicKeyBytes = await sha256Hash(privateKeyBytes);

  // Solana addresses are base58-encoded 32-byte public keys
  // Using a simplified base58 encoding
  const address = base58Encode(publicKeyBytes);

  // Encrypt private key for storage
  const privateKeyEncrypted = await encryptPrivateKey(privateKeyHex, encryptionKey);

  return {
    chainType: 'svm',
    address: address,
    privateKeyEncrypted
  };
}

// Base58 encoding for Solana and Bitcoin addresses
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

  // Convert to string
  let result = '';

  // Add leading '1's for leading zero bytes
  for (let i = 0; i < bytes.length && bytes[i] === 0; i++) {
    result += '1';
  }

  // Convert digits to base58 characters (reverse order)
  for (let i = digits.length - 1; i >= 0; i--) {
    result += BASE58_ALPHABET[digits[i]];
  }

  return result;
}

// Generate Bitcoin address (P2PKH format - starts with 1)
async function generateBTCAddress(encryptionKey: string): Promise<WalletAddress> {
  // Bitcoin uses secp256k1 - 32 byte private key
  const privateKeyBytes = await getRandomBytes(32);
  const privateKeyHex = bytesToHex(privateKeyBytes);

  // Derive public key hash (simplified - in production use proper secp256k1)
  const publicKeyHash = await sha256Hash(privateKeyBytes);

  // Bitcoin P2PKH address:
  // 1. Take RIPEMD160(SHA256(pubkey)) - we'll use SHA256 twice as approximation
  const hash160 = await sha256Hash(publicKeyHash);
  const addressHash = hash160.slice(0, 20); // Take first 20 bytes

  // 2. Add version byte (0x00 for mainnet)
  const versionedPayload = new Uint8Array(21);
  versionedPayload[0] = 0x00; // Mainnet version byte
  versionedPayload.set(addressHash, 1);

  // 3. Calculate checksum (first 4 bytes of double SHA256)
  const firstHash = await sha256Hash(versionedPayload);
  const secondHash = await sha256Hash(firstHash);
  const checksum = secondHash.slice(0, 4);

  // 4. Append checksum
  const fullAddress = new Uint8Array(25);
  fullAddress.set(versionedPayload);
  fullAddress.set(checksum, 21);

  // 5. Base58 encode
  const address = base58Encode(fullAddress);

  // Encrypt private key for storage
  const privateKeyEncrypted = await encryptPrivateKey(privateKeyHex, encryptionKey);

  return {
    chainType: 'btc',
    address: address,
    privateKeyEncrypted
  };
}

// Generate TRON address (starts with T, uses base58check like Bitcoin but with version byte 0x41)
async function generateTRONAddress(encryptionKey: string): Promise<WalletAddress> {
  // TRON uses secp256k1 - 32 byte private key (same as Ethereum/Bitcoin)
  const privateKeyBytes = await getRandomBytes(32);
  const privateKeyHex = bytesToHex(privateKeyBytes);

  // Derive address from public key hash (simplified)
  const publicKeyHash = await sha256Hash(privateKeyBytes);
  const addressHash = publicKeyHash.slice(12, 32); // Take last 20 bytes (like EVM)

  // TRON address format:
  // 1. Add version byte (0x41 for mainnet)
  const versionedPayload = new Uint8Array(21);
  versionedPayload[0] = 0x41; // TRON mainnet version byte
  versionedPayload.set(addressHash, 1);

  // 2. Calculate checksum (first 4 bytes of double SHA256)
  const firstHash = await sha256Hash(versionedPayload);
  const secondHash = await sha256Hash(firstHash);
  const checksum = secondHash.slice(0, 4);

  // 3. Append checksum
  const fullAddress = new Uint8Array(25);
  fullAddress.set(versionedPayload);
  fullAddress.set(checksum, 21);

  // 4. Base58 encode
  const address = base58Encode(fullAddress);

  // Encrypt private key for storage
  const privateKeyEncrypted = await encryptPrivateKey(privateKeyHex, encryptionKey);

  return {
    chainType: 'tron',
    address: address,
    privateKeyEncrypted
  };
}

// Generate TON address (uses base64url encoded format)
async function generateTONAddress(encryptionKey: string): Promise<WalletAddress> {
  // TON uses Ed25519 - 32 byte private key
  const privateKeyBytes = await getRandomBytes(32);
  const privateKeyHex = bytesToHex(privateKeyBytes);

  // Derive public key (simplified - in production use proper Ed25519)
  const publicKeyBytes = await sha256Hash(privateKeyBytes);

  // TON address format (simplified - bounceable user-friendly format):
  // Format: workchain (1 byte) + hash (32 bytes) -> base64url
  // Using workchain 0 (basechain)
  const addressData = new Uint8Array(34);

  // Tag for bounceable address: 0x11 (workchain 0, bounceable)
  addressData[0] = 0x11;
  // Workchain ID (0 for basechain)
  addressData[1] = 0x00;
  // Account ID (hash of public key)
  addressData.set(publicKeyBytes, 2);

  // Calculate CRC16 checksum
  const crc = crc16(addressData);

  // Final address with checksum
  const fullAddress = new Uint8Array(36);
  fullAddress.set(addressData);
  fullAddress[34] = (crc >> 8) & 0xff;
  fullAddress[35] = crc & 0xff;

  // Base64url encode
  const address = base64UrlEncode(fullAddress);

  // Encrypt private key for storage
  const privateKeyEncrypted = await encryptPrivateKey(privateKeyHex, encryptionKey);

  return {
    chainType: 'ton',
    address: address,
    privateKeyEncrypted
  };
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

// Base64url encoding for TON addresses
function base64UrlEncode(data: Uint8Array): string {
  const base64 = btoa(String.fromCharCode(...data));
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// Main function to generate all wallet addresses for a user
export async function generateWalletAddresses(encryptionKey: string): Promise<WalletAddress[]> {
  const [evmWallet, svmWallet, btcWallet, tronWallet, tonWallet] = await Promise.all([
    generateEVMAddress(encryptionKey),
    generateSVMAddress(encryptionKey),
    generateBTCAddress(encryptionKey),
    generateTRONAddress(encryptionKey),
    generateTONAddress(encryptionKey)
  ]);

  return [evmWallet, svmWallet, btcWallet, tronWallet, tonWallet];
}

// Store wallet addresses in database
export async function storeWalletAddresses(
  db: D1Database,
  userId: string,
  addresses: WalletAddress[]
): Promise<void> {
  for (const wallet of addresses) {
    const id = generateId();
    await db.prepare(
      `INSERT INTO wallet_addresses (id, user_id, chain_type, address, private_key_encrypted)
       VALUES (?, ?, ?, ?, ?)`
    ).bind(
      id,
      userId,
      wallet.chainType,
      wallet.address,
      wallet.privateKeyEncrypted
    ).run();
  }
}

// Get wallet addresses for a user
export async function getWalletAddresses(
  db: D1Database,
  userId: string
): Promise<{ chainType: string; address: string }[]> {
  const result = await db.prepare(
    'SELECT chain_type, address FROM wallet_addresses WHERE user_id = ?'
  ).bind(userId).all();

  return (result.results || []).map(row => ({
    chainType: row.chain_type as string,
    address: row.address as string
  }));
}
