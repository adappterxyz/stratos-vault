import { SpliceClient } from './splice-client';
import { CantonJsonClient } from './canton-json-client';

export interface Env {
  SPLICE_HOST: string;
  SPLICE_PORT: string;
  CANTON_JSON_HOST: string;
  CANTON_JSON_PORT: string;
  CANTON_AUTH_SECRET: string;
  CANTON_AUTH_USER: string;
  SPLICE_ADMIN_USER: string;
  CANTON_AUTH_AUDIENCE: string;
  DB: D1Database;
  RP_ID: string;
  RP_NAME: string;
  THEME?: string;
  ORG_NAME?: string;
  DOCK_APPS?: string;
  ALLOWED_IFRAME_ORIGINS?: string;
  CHAT_AGENT_WEBHOOK_URL?: string;
}

export function getSpliceClientForUser(env: Env, username?: string): SpliceClient {
  return new SpliceClient({
    validatorHost: env.SPLICE_HOST || 'localhost',
    validatorPort: parseInt(env.SPLICE_PORT || '443'),
    authSecret: env.CANTON_AUTH_SECRET || 'unsafe',
    authUser: username || env.CANTON_AUTH_USER || 'ledger-api-user',
    authAudience: env.CANTON_AUTH_AUDIENCE || 'https://canton.network.global'
  });
}

export function getSpliceAdminClient(env: Env): SpliceClient {
  return new SpliceClient({
    validatorHost: env.SPLICE_HOST || 'localhost',
    validatorPort: parseInt(env.SPLICE_PORT || '443'),
    authSecret: env.CANTON_AUTH_SECRET || 'unsafe',
    authUser: env.SPLICE_ADMIN_USER || 'app-user',
    authAudience: env.CANTON_AUTH_AUDIENCE || 'https://canton.network.global'
  });
}

export function getCantonJsonClient(env: Env): CantonJsonClient {
  return new CantonJsonClient({
    host: env.CANTON_JSON_HOST || env.SPLICE_HOST || 'localhost',
    port: parseInt(env.CANTON_JSON_PORT || '443'),
    authSecret: env.CANTON_AUTH_SECRET || 'unsafe',
    authUser: env.CANTON_AUTH_USER || 'ledger-api-user',
    authAudience: env.CANTON_AUTH_AUDIENCE || 'https://canton.network.global'
  });
}

export function jsonResponse(data: any, status: number = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-Wallet-User, X-Admin-Token, X-Superadmin-Token, Authorization'
    }
  });
}

export function errorResponse(error: string, status: number = 500) {
  return jsonResponse({ success: false, error }, status);
}

export function handleCors(request: Request): Response | null {
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, X-Wallet-User, X-Admin-Token, X-Superadmin-Token, Authorization',
        'Access-Control-Allow-Credentials': 'true'
      }
    });
  }
  return null;
}

export function jsonResponseWithCookie(data: any, cookie: string, status: number = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-Wallet-User, Authorization',
      'Access-Control-Allow-Credentials': 'true',
      'Set-Cookie': cookie
    }
  });
}

export function generateId(): string {
  return crypto.randomUUID();
}

export interface SessionUser {
  id: string;
  username: string;
  displayName: string;
  partyId: string | null;
  role: string;
}

export async function validateSession(db: D1Database, sessionId: string | null): Promise<SessionUser | null> {
  if (!sessionId) return null;

  const session = await db.prepare(
    `SELECT s.*, u.username, u.display_name, u.party_id, u.role
     FROM sessions s
     JOIN users u ON s.user_id = u.id
     WHERE s.id = ? AND s.expires_at > datetime("now")`
  ).bind(sessionId).first();

  if (!session) return null;

  return {
    id: session.user_id as string,
    username: session.username as string,
    displayName: session.display_name as string,
    partyId: session.party_id as string | null,
    role: (session.role as string) || 'user'
  };
}

export async function requireAdmin(request: Request, db: D1Database): Promise<{ user: SessionUser } | Response> {
  // First, check for admin token (separate admin auth system)
  const adminToken = request.headers.get('X-Admin-Token');
  if (adminToken) {
    const isValidAdminToken = await validateAdminToken(db, adminToken);
    if (isValidAdminToken) {
      // Return a placeholder admin user for admin token auth
      return {
        user: {
          id: 'admin',
          username: 'admin',
          displayName: 'Admin',
          partyId: null,
          role: 'admin'
        }
      };
    }
  }

  // Check for superadmin token (new superadmin auth system)
  const superadminToken = request.headers.get('X-Superadmin-Token');
  if (superadminToken) {
    const superadminUser = await validateSuperadminSession(db, superadminToken);
    if (superadminUser) {
      // Return a session user representation for superadmin
      return {
        user: {
          id: superadminUser.id,
          username: superadminUser.username,
          displayName: superadminUser.displayName || 'Superadmin',
          partyId: null,
          role: 'admin'
        }
      };
    }
  }

  // Fall back to regular session-based admin auth
  const sessionId = request.headers.get('Authorization')?.replace('Bearer ', '') || null;
  const user = await validateSession(db, sessionId);

  if (!user) {
    return errorResponse('Unauthorized', 401);
  }

  if (user.role !== 'admin') {
    return errorResponse('Admin access required', 403);
  }

  return { user };
}

export async function requireAuth(request: Request, db: D1Database): Promise<{ user: SessionUser } | Response> {
  const sessionId = request.headers.get('Authorization')?.replace('Bearer ', '') || null;
  const user = await validateSession(db, sessionId);

  if (!user) {
    return errorResponse('Unauthorized', 401);
  }

  return { user };
}

export async function validateAdminToken(db: D1Database, token: string | null): Promise<boolean> {
  if (!token) return false;

  const session = await db.prepare(
    `SELECT * FROM admin_sessions WHERE id = ? AND expires_at > datetime('now')`
  ).bind(token).first();

  return !!session;
}

// Superadmin session user interface
export interface SuperadminUser {
  id: string;
  username: string;
  displayName: string | null;
  isSuperadmin: boolean;
}

// Validate superadmin session and return user
export async function validateSuperadminSession(db: D1Database, token: string | null): Promise<SuperadminUser | null> {
  if (!token) return null;

  const session = await db.prepare(
    `SELECT s.*, u.id as user_id, u.username, u.display_name, u.is_superadmin
     FROM superadmin_sessions s
     JOIN superadmin_users u ON s.user_id = u.id
     WHERE s.id = ? AND s.expires_at > datetime('now')`
  ).bind(token).first();

  if (!session) return null;

  return {
    id: session.user_id as string,
    username: session.username as string,
    displayName: session.display_name as string | null,
    isSuperadmin: (session.is_superadmin as number) === 1
  };
}

// Require superadmin authentication
export async function requireSuperadmin(request: Request, db: D1Database): Promise<{ user: SuperadminUser } | Response> {
  const token = request.headers.get('X-Superadmin-Token');
  const user = await validateSuperadminSession(db, token);

  if (!user) {
    return errorResponse('Unauthorized', 401);
  }

  return { user };
}

// Require superadmin privileges (is_superadmin = 1)
export async function requireSuperadminPrivilege(request: Request, db: D1Database): Promise<{ user: SuperadminUser } | Response> {
  const token = request.headers.get('X-Superadmin-Token');
  const user = await validateSuperadminSession(db, token);

  if (!user) {
    return errorResponse('Unauthorized', 401);
  }

  if (!user.isSuperadmin) {
    return errorResponse('Superadmin privileges required', 403);
  }

  return { user };
}

// Transaction recording interface
export interface RecordTransactionParams {
  userId: string;
  txHash?: string;
  txType: 'send' | 'receive' | 'swap' | 'bridge' | 'tap' | 'fee';
  status?: 'pending' | 'confirmed' | 'failed';
  assetSymbol: string;
  chain: string;
  chainType: string;
  amount: string;
  amountUsd?: string;
  fee?: string;
  feeAsset?: string;
  fromAddress?: string;
  toAddress?: string;
  description?: string;
  metadata?: Record<string, any>;
  blockNumber?: number;
  blockTimestamp?: string;
}

// Record a transaction to the database
export async function recordTransaction(db: D1Database, params: RecordTransactionParams): Promise<string> {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  await db.prepare(
    `INSERT INTO transactions (
      id, user_id, tx_hash, tx_type, status, asset_symbol, chain, chain_type,
      amount, amount_usd, fee, fee_asset, from_address, to_address,
      description, metadata, block_number, block_timestamp, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    id,
    params.userId,
    params.txHash || null,
    params.txType,
    params.status || 'confirmed',
    params.assetSymbol,
    params.chain,
    params.chainType,
    params.amount,
    params.amountUsd || null,
    params.fee || null,
    params.feeAsset || null,
    params.fromAddress || null,
    params.toAddress || null,
    params.description || null,
    params.metadata ? JSON.stringify(params.metadata) : null,
    params.blockNumber || null,
    params.blockTimestamp || null,
    now,
    now
  ).run();

  return id;
}

// Update transaction status
export async function updateTransactionStatus(
  db: D1Database,
  txId: string,
  status: 'pending' | 'confirmed' | 'failed',
  txHash?: string
): Promise<void> {
  const now = new Date().toISOString();
  if (txHash) {
    await db.prepare(
      `UPDATE transactions SET status = ?, tx_hash = ?, updated_at = ? WHERE id = ?`
    ).bind(status, txHash, now, txId).run();
  } else {
    await db.prepare(
      `UPDATE transactions SET status = ?, updated_at = ? WHERE id = ?`
    ).bind(status, now, txId).run();
  }
}

// Password hashing using Web Crypto API (PBKDF2)
export async function hashPassword(password: string): Promise<string> {
  const encoder = new TextEncoder();
  const salt = crypto.getRandomValues(new Uint8Array(16));

  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  );

  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: salt,
      iterations: 100000,
      hash: 'SHA-256'
    },
    keyMaterial,
    256
  );

  const hashArray = new Uint8Array(derivedBits);
  const saltHex = Array.from(salt).map(b => b.toString(16).padStart(2, '0')).join('');
  const hashHex = Array.from(hashArray).map(b => b.toString(16).padStart(2, '0')).join('');

  return `${saltHex}:${hashHex}`;
}

// Verify password against hash
export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  const [saltHex, hashHex] = storedHash.split(':');
  if (!saltHex || !hashHex) return false;

  const salt = new Uint8Array(saltHex.match(/.{2}/g)!.map(byte => parseInt(byte, 16)));
  const encoder = new TextEncoder();

  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  );

  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: salt,
      iterations: 100000,
      hash: 'SHA-256'
    },
    keyMaterial,
    256
  );

  const hashArray = new Uint8Array(derivedBits);
  const computedHashHex = Array.from(hashArray).map(b => b.toString(16).padStart(2, '0')).join('');

  return computedHashHex === hashHex;
}
