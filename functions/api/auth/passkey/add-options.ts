import { generateRegistrationOptions } from '@simplewebauthn/server';
import { jsonResponse, errorResponse, handleCors, generateId, requireAuth, Env } from '../../../_lib/utils';

export async function onRequestPost(context: { request: Request; env: Env }) {
  const corsResponse = handleCors(context.request);
  if (corsResponse) return corsResponse;

  try {
    const authResult = await requireAuth(context.request, context.env.DB);
    if (authResult instanceof Response) return authResult;
    const { user } = authResult;

    // Enforce max 5 passkeys
    const countResult = await context.env.DB.prepare(
      'SELECT COUNT(*) as count FROM passkeys WHERE user_id = ?'
    ).bind(user.id).first();

    if (countResult && (countResult.count as number) >= 5) {
      return errorResponse('Maximum of 5 passkeys allowed', 400);
    }

    // Get existing credential_ids for excludeCredentials
    const existingPasskeys = await context.env.DB.prepare(
      'SELECT credential_id FROM passkeys WHERE user_id = ?'
    ).bind(user.id).all();

    const excludeCredentials = existingPasskeys.results.map((pk: any) => ({
      id: pk.credential_id,
      type: 'public-key' as const,
    }));

    // Get RP_ID from request origin or env
    const origin = context.request.headers.get('origin') || '';
    const rpID = new URL(origin).hostname || context.env.RP_ID;

    // Generate registration options
    const options = await generateRegistrationOptions({
      rpName: context.env.RP_NAME || 'Canton Wallet',
      rpID,
      userID: new TextEncoder().encode(user.id),
      userName: user.username,
      userDisplayName: user.displayName || user.username,
      attestationType: 'none',
      excludeCredentials,
      authenticatorSelection: {
        residentKey: 'preferred',
        userVerification: 'required',
      },
    });

    // Store challenge with type 'add_passkey'
    const challengeId = generateId();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();

    await context.env.DB.prepare(
      'INSERT INTO challenges (id, challenge, user_id, type, expires_at) VALUES (?, ?, ?, ?, ?)'
    ).bind(challengeId, options.challenge, user.id, 'add_passkey', expiresAt).run();

    return jsonResponse({
      success: true,
      data: { options }
    });
  } catch (error) {
    console.error('Error generating add-passkey options:', error);
    return errorResponse(error instanceof Error ? error.message : 'Failed to generate options');
  }
}

export async function onRequestOptions(context: { request: Request }) {
  return handleCors(context.request);
}
