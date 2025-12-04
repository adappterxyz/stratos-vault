/**
 * Canton Contract Exercise API
 * POST /api/canton/exercise
 *
 * Exercise a choice on a contract
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

interface ExerciseRequest {
  contractId: string;
  templateId: string;
  choice: string;
  argument: Record<string, unknown>;
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

    const body = await request.json() as ExerciseRequest;
    if (!body.contractId || !body.templateId || !body.choice) {
      return new Response(JSON.stringify({
        success: false,
        error: 'contractId, templateId, and choice are required'
      }), {
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

    // Exercise choice
    const result = await cantonClient.exerciseChoice(
      user.partyId,
      body.contractId,
      body.templateId,
      body.choice,
      body.argument || {}
    );

    return new Response(JSON.stringify({ success: true, data: result }), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('Canton exercise error:', error);
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Exercise failed'
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};
