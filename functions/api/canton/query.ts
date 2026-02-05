/**
 * Canton Contract Query API
 * POST /api/canton/query
 *
 * Query contracts by template ID
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

interface QueryRequest {
  templateId: string;
  filter?: Record<string, unknown>;
  readAs?: string[];  // Additional parties to read as (e.g., public party)
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

    const body = await request.json() as QueryRequest;
    if (!body.templateId) {
      return new Response(JSON.stringify({ success: false, error: 'templateId is required' }), {
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

    // Debug logging
    console.log('Canton query request:', JSON.stringify({
      host: env.CANTON_JSON_HOST,
      port: env.CANTON_JSON_PORT,
      authSecretLength: env.CANTON_AUTH_SECRET?.length || 0,
      authUser: env.CANTON_AUTH_USER,
      userPartyId: user.partyId,
      templateId: body.templateId,
      readAs: body.readAs,
      filter: body.filter
    }));

    // Query contracts (include readAs parties for visibility)
    const contracts = await cantonClient.queryContracts(
      user.partyId,
      body.templateId,
      body.filter,
      body.readAs
    );

    console.log('Canton query result:', JSON.stringify({
      count: contracts.length,
      contracts: contracts.slice(0, 2)
    }));

    return new Response(JSON.stringify({ success: true, data: contracts }), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('Canton query error:', error);
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Query failed'
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};
