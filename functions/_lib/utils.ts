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
      'Access-Control-Allow-Headers': 'Content-Type, X-Wallet-User, X-Admin-Token, Authorization'
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
        'Access-Control-Allow-Headers': 'Content-Type, X-Wallet-User, X-Admin-Token, Authorization',
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
