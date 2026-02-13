// Wallet address storage utilities
// All key generation and encryption is done client-side using WebAuthn PRF

import { generateId } from './utils';

export interface WalletAddress {
  chainType: 'evm' | 'svm' | 'btc' | 'tron' | 'ton';
  address: string;
  privateKeyEncrypted: string;
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
