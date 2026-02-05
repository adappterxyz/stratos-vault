/**
 * Canton Grant User Rights API
 * POST /api/canton/grant-rights
 *
 * Grant user rights (e.g., readAs public party) on the Canton ledger
 */

import { CantonJsonClient } from '../../_lib/canton-json-client';
import { validateSession } from '../../_lib/utils';

interface Env {
  DB: D1Database;
  CANTON_JSON_HOST: string;
  CANTON_JSON_PORT: string;
  CANTON_AUTH_SECRET: string;
  CANTON_AUTH_USER: string;
  CANTON_AUTH_AUDIENCE: string;
}

type CantonUserRight =
  | { type: 'actAs'; party: string }
  | { type: 'readAs'; party: string }
  | { type: 'participantAdmin' };

interface GrantRightsRequest {
  userId: string;
  rights: CantonUserRight[];
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { request, env } = context;

  try {
    // Verify session
    const authHeader = request.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ success: false, error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const sessionId = authHeader.slice(7);
    const user = await validateSession(env.DB, sessionId);
    if (!user || !user.partyId) {
      return new Response(JSON.stringify({ success: false, error: 'No party ID linked' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const body = await request.json() as GrantRightsRequest;
    if (!body.userId || !body.rights || !Array.isArray(body.rights)) {
      return new Response(JSON.stringify({ success: false, error: 'userId and rights array are required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Security: Only allow granting rights to the current user
    // This prevents users from escalating privileges for other users
    if (body.userId !== user.partyId) {
      return new Response(JSON.stringify({ success: false, error: 'Can only grant rights to your own user' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Create Canton client
    const cantonClient = new CantonJsonClient({
      host: env.CANTON_JSON_HOST,
      port: parseInt(env.CANTON_JSON_PORT || '443'),
      authSecret: env.CANTON_AUTH_SECRET,
      authUser: env.CANTON_AUTH_USER,
      authAudience: env.CANTON_AUTH_AUDIENCE
    });

    // Grant rights
    const result = await cantonClient.grantUserRights(body.userId, body.rights);

    return new Response(JSON.stringify({
      success: true,
      data: {
        userId: body.userId,
        grantedRights: result.grantedRights
      }
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('Canton grant-rights error:', error);
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Grant rights failed'
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};
