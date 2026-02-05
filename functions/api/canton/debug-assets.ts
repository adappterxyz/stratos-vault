/**
 * Canton Debug Assets API
 * GET /api/canton/debug-assets?templateId=...
 *
 * Debug endpoint to query contracts directly without readAs filter
 * to see what contracts exist and what their observers are.
 * Requires superadmin authentication.
 */

import { CantonJsonClient } from '../../_lib/canton-json-client';

interface Env {
  DB: D1Database;
  CANTON_JSON_HOST: string;
  CANTON_JSON_PORT: string;
  CANTON_AUTH_SECRET: string;
  CANTON_AUTH_USER: string;
  CANTON_AUTH_AUDIENCE: string;
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { request, env } = context;

  try {
    // Check for superadmin auth (simple token check)
    const authHeader = request.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ success: false, error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const sessionId = authHeader.slice(7);

    // Verify superadmin
    const session = await env.DB.prepare(
      `SELECT u.id, u.is_superadmin FROM sessions s
       JOIN users u ON s.user_id = u.id
       WHERE s.id = ? AND s.expires_at > datetime('now')`
    ).bind(sessionId).first() as { id: string; is_superadmin: boolean } | null;

    if (!session?.is_superadmin) {
      return new Response(JSON.stringify({ success: false, error: 'Superadmin required' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const url = new URL(request.url);
    const templateId = url.searchParams.get('templateId');
    const operatorParty = url.searchParams.get('operatorParty');

    if (!templateId) {
      return new Response(JSON.stringify({ success: false, error: 'templateId required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    if (!operatorParty) {
      return new Response(JSON.stringify({ success: false, error: 'operatorParty required' }), {
        status: 400,
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

    console.log('Debug query:', { host: env.CANTON_JSON_HOST, templateId, operatorParty });

    // Query as operator (who is signatory on most contracts)
    const contracts = await cantonClient.queryContracts(
      operatorParty,
      templateId,
      undefined,
      [operatorParty] // Query as operator to see contracts where operator is signatory/observer
    );

    // Extract observer info from contracts
    const contractInfo = contracts.map(c => ({
      contractId: c.contractId,
      signatories: c.signatories,
      observers: c.observers,
      publicField: c.payload?.public || c.payload?.publicParty || 'not found',
      payloadKeys: Object.keys(c.payload || {})
    }));

    return new Response(JSON.stringify({
      success: true,
      cantonHost: env.CANTON_JSON_HOST,
      queriedAs: operatorParty,
      templateId,
      count: contracts.length,
      contracts: contractInfo
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('Debug assets error:', error);
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Debug failed'
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};

export const onRequestOptions: PagesFunction = async () => {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type'
    }
  });
};
