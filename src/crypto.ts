// Client-side cryptography utilities using WebAuthn PRF extension
// This ensures private keys are encrypted with a key derived from the user's passkey
// Even the server/webmaster cannot decrypt without the physical passkey

import { ed25519 } from '@noble/curves/ed25519.js';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { keccak_256 } from '@noble/hashes/sha3.js';
import { ripemd160 } from '@noble/hashes/legacy.js';
import { sha256 as sha256Hash } from '@noble/hashes/sha2.js';

// PRF salt for wallet encryption - must be consistent
const PRF_SALT = new TextEncoder().encode('canton-wallet-encryption-v1');

// Convert bytes to hex string
export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

// Convert hex string to bytes
export function hexToBytes(hex: string): Uint8Array {
  const cleanHex = hex.startsWith('0x') ? hex.slice(2) : hex;
  const bytes = new Uint8Array(cleanHex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(cleanHex.substr(i * 2, 2), 16);
  }
  return bytes;
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

// Base64url encoding for TON addresses
function base64UrlEncode(data: Uint8Array): string {
  const base64 = btoa(String.fromCharCode(...data));
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
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

// Derive AES-GCM key from PRF output
async function deriveEncryptionKey(prfOutput: ArrayBuffer): Promise<CryptoKey> {
  // Import PRF output as raw key material
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    prfOutput,
    'HKDF',
    false,
    ['deriveKey']
  );

  // Derive AES-256-GCM key using HKDF
  return crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: new TextEncoder().encode('canton-wallet-aes-key'),
      info: new TextEncoder().encode('encryption')
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

// Encrypt data with AES-GCM
async function encryptAESGCM(key: CryptoKey, plaintext: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12)); // 96-bit IV
  const encoded = new TextEncoder().encode(plaintext);

  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    encoded
  );

  // Combine IV + ciphertext and return as hex
  const combined = new Uint8Array(iv.length + ciphertext.byteLength);
  combined.set(iv);
  combined.set(new Uint8Array(ciphertext), iv.length);

  return bytesToHex(combined);
}

// Decrypt data with AES-GCM
async function decryptAESGCM(key: CryptoKey, encryptedHex: string): Promise<string> {
  const combined = hexToBytes(encryptedHex);

  // Extract IV (first 12 bytes) and ciphertext
  const iv = combined.slice(0, 12);
  const ciphertext = combined.slice(12);

  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    key,
    ciphertext
  );

  return new TextDecoder().decode(decrypted);
}

// Wallet address types
export interface WalletData {
  chainType: 'evm' | 'svm' | 'btc' | 'tron' | 'ton';
  address: string;
  privateKeyEncrypted: string;
}

// Generate a single wallet
async function generateWallet(
  chainType: 'evm' | 'svm' | 'btc' | 'tron' | 'ton',
  encryptionKey: CryptoKey
): Promise<WalletData> {
  // Generate 32 random bytes for private key
  const privateKeyBytes = crypto.getRandomValues(new Uint8Array(32));
  const privateKeyHex = bytesToHex(privateKeyBytes);

  let address: string;

  switch (chainType) {
    case 'evm': {
      // EVM: Keccak256 of uncompressed public key (without 04 prefix), take last 20 bytes
      const publicKey = secp256k1.getPublicKey(privateKeyBytes, false); // uncompressed
      const pubKeyNoPrefix = publicKey.slice(1); // remove 04 prefix
      const hash = keccak_256(pubKeyNoPrefix);
      address = '0x' + bytesToHex(hash.slice(12)); // last 20 bytes
      break;
    }
    case 'svm': {
      // Solana: Ed25519 public key as base58
      const publicKey = ed25519.getPublicKey(privateKeyBytes);
      address = base58Encode(publicKey);
      break;
    }
    case 'btc': {
      // Bitcoin P2PKH: RIPEMD160(SHA256(compressed_pubkey)) with version 0x00
      const publicKey = secp256k1.getPublicKey(privateKeyBytes, true); // compressed
      const sha256Hash1 = sha256Hash(publicKey);
      const pubKeyHash = ripemd160(sha256Hash1);

      const versioned = new Uint8Array(21);
      versioned[0] = 0x00; // mainnet
      versioned.set(pubKeyHash, 1);

      // Double SHA256 for checksum
      const check1 = sha256Hash(versioned);
      const check2 = sha256Hash(check1);
      const checksum = check2.slice(0, 4);

      const full = new Uint8Array(25);
      full.set(versioned);
      full.set(checksum, 21);

      address = base58Encode(full);
      break;
    }
    case 'tron': {
      // TRON: Keccak256 of uncompressed public key, take last 20 bytes, prefix with 0x41
      const publicKey = secp256k1.getPublicKey(privateKeyBytes, false); // uncompressed
      const pubKeyNoPrefix = publicKey.slice(1); // remove 04 prefix
      const hash = keccak_256(pubKeyNoPrefix);
      const addressHash = hash.slice(12); // last 20 bytes

      const versioned = new Uint8Array(21);
      versioned[0] = 0x41; // TRON mainnet prefix
      versioned.set(addressHash, 1);

      // Double SHA256 for checksum
      const check1 = sha256Hash(versioned);
      const check2 = sha256Hash(check1);
      const checksum = check2.slice(0, 4);

      const full = new Uint8Array(25);
      full.set(versioned);
      full.set(checksum, 21);

      address = base58Encode(full);
      break;
    }
    case 'ton': {
      // TON: Ed25519 public key hash with workchain and bounceable flag
      const publicKey = ed25519.getPublicKey(privateKeyBytes);
      const hash = sha256Hash(publicKey);

      const addressData = new Uint8Array(34);
      addressData[0] = 0x11; // Bounceable
      addressData[1] = 0x00; // Workchain 0
      addressData.set(hash, 2);

      const crc = crc16(addressData);
      const full = new Uint8Array(36);
      full.set(addressData);
      full[34] = (crc >> 8) & 0xff;
      full[35] = crc & 0xff;

      address = base64UrlEncode(full);
      break;
    }
  }

  // Encrypt private key with PRF-derived key
  const privateKeyEncrypted = await encryptAESGCM(encryptionKey, privateKeyHex);

  // Zero out private key bytes
  privateKeyBytes.fill(0);

  return {
    chainType,
    address,
    privateKeyEncrypted
  };
}

// Generate all wallets client-side
export async function generateAllWallets(prfOutput: ArrayBuffer): Promise<WalletData[]> {
  return generateWalletsForChains(prfOutput, ['evm', 'svm', 'btc', 'tron', 'ton']);
}

// Generate wallets for specific chain types only
export async function generateWalletsForChains(
  prfOutput: ArrayBuffer,
  chainTypes: Array<'evm' | 'svm' | 'btc' | 'tron' | 'ton'>
): Promise<WalletData[]> {
  const encryptionKey = await deriveEncryptionKey(prfOutput);

  const wallets = await Promise.all(
    chainTypes.map(chainType => generateWallet(chainType, encryptionKey))
  );

  return wallets;
}

// Decrypt a private key using PRF output
export async function decryptPrivateKey(
  prfOutput: ArrayBuffer,
  encryptedHex: string
): Promise<string> {
  const encryptionKey = await deriveEncryptionKey(prfOutput);
  return decryptAESGCM(encryptionKey, encryptedHex);
}

// Get PRF extension options for WebAuthn
export function getPrfExtension() {
  return {
    prf: {
      eval: {
        first: PRF_SALT
      }
    }
  };
}

// Check if PRF is supported by checking the credential response
export function getPrfOutput(credential: any): ArrayBuffer | null {
  const prfResults = credential.clientExtensionResults?.prf?.results;
  if (prfResults?.first) {
    return prfResults.first;
  }
  return null;
}

// Check if browser supports PRF
export function isPrfSupported(): boolean {
  // PRF requires WebAuthn Level 3
  return 'PublicKeyCredential' in window;
}

// Zero out a Uint8Array to remove sensitive data from memory
export function zeroBytes(arr: Uint8Array): void {
  arr.fill(0);
}

// Zero out an ArrayBuffer to remove sensitive data from memory
export function zeroBuffer(buf: ArrayBuffer): void {
  new Uint8Array(buf).fill(0);
}
