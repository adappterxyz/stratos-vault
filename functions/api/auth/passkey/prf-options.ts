/**
 * PRF Re-authentication Options API
 *
 * Returns WebAuthn options for re-authenticating to get PRF output
 * for signing operations. Requires an active session.
 */

import { generateAuthenticationOptions } from '@simplewebauthn/server';
import { jsonResponse, errorResponse, handleCors, generateId, requireAuth, Env } from '../../../_lib/utils';

export async function onRequestPost(context: { request: Request; env: Env }) {
  const corsResponse = handleCors(context.request);
  if (corsResponse) return corsResponse;

  try {
    // Require active session
    const authResult = await requireAuth(context.request, context.env.DB);
    if (authResult instanceof Response) return authResult;
    const { user } = authResult;

    // Get user's passkeys
    const passkeys = await context.env.DB.prepare(
      'SELECT credential_id, transports FROM passkeys WHERE user_id = ?'
    ).bind(user.id).all();

    if (passkeys.results.length === 0) {
      return errorResponse('No passkeys found for user', 404);
    }

    const allowCredentials = passkeys.results.map((pk: any) => ({
      id: pk.credential_id,
      type: 'public-key' as const,
      transports: JSON.parse(pk.transports || '[]'),
    }));

    // Get RP_ID from request origin
    const origin = context.request.headers.get('origin') || '';
    const rpID = new URL(origin).hostname || context.env.RP_ID;

    // Generate authentication options
    const options = await generateAuthenticationOptions({
      rpID,
      allowCredentials,
      userVerification: 'required',
    });

    // Store challenge for verification
    const challengeId = generateId();
    const expiresAt = new Date(Date.now() + 2 * 60 * 1000).toISOString(); // 2 minutes

    await context.env.DB.prepare(
      'INSERT INTO challenges (id, challenge, user_id, type, expires_at) VALUES (?, ?, ?, ?, ?)'
    ).bind(challengeId, options.challenge, user.id, 'prf-auth', expiresAt).run();

    return jsonResponse({
      success: true,
      data: { options }
    });
  } catch (error) {
    console.error('Error generating PRF auth options:', error);
    return errorResponse(error instanceof Error ? error.message : 'Failed to generate PRF options');
  }
}

export async function onRequestOptions(context: { request: Request }) {
  return handleCors(context.request);
}
