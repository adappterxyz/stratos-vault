import { generateRegistrationOptions } from '@simplewebauthn/server';
import { jsonResponse, errorResponse, handleCors, generateId, Env } from '../../../_lib/utils';

export async function onRequestPost(context: { request: Request; env: Env }) {
  const corsResponse = handleCors(context.request);
  if (corsResponse) return corsResponse;

  try {
    const { username, displayName, registrationCode } = await context.request.json() as {
      username: string;
      displayName?: string;
      registrationCode?: string;
    };

    if (!username) {
      return errorResponse('Username is required', 400);
    }

    // Validate registration code
    if (!registrationCode) {
      return errorResponse('Registration code is required', 400);
    }

    const codeResult = await context.env.DB.prepare(
      `SELECT id, uses_remaining, expires_at
       FROM registration_codes
       WHERE code = ?`
    ).bind(registrationCode.toUpperCase()).first();

    if (!codeResult) {
      return errorResponse('Invalid registration code', 400);
    }

    if (codeResult.expires_at && new Date(codeResult.expires_at as string) < new Date()) {
      return errorResponse('Registration code has expired', 400);
    }

    if ((codeResult.uses_remaining as number) <= 0) {
      return errorResponse('Registration code has been fully used', 400);
    }

    // Check if user already exists
    const existingUser = await context.env.DB.prepare(
      'SELECT id FROM users WHERE username = ?'
    ).bind(username).first();

    let userId: string;

    if (existingUser) {
      userId = existingUser.id as string;
    } else {
      // Create new user
      userId = generateId();
      await context.env.DB.prepare(
        'INSERT INTO users (id, username, display_name) VALUES (?, ?, ?)'
      ).bind(userId, username, displayName || username).run();
    }

    // Get existing passkeys for this user
    const existingPasskeys = await context.env.DB.prepare(
      'SELECT credential_id FROM passkeys WHERE user_id = ?'
    ).bind(userId).all();

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
      userID: new TextEncoder().encode(userId),
      userName: username,
      userDisplayName: displayName || username,
      attestationType: 'none',
      excludeCredentials,
      authenticatorSelection: {
        residentKey: 'preferred',
        userVerification: 'required',
      },
    });

    // Store challenge with registration code ID
    const challengeId = generateId();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString(); // 5 minutes
    const metadata = JSON.stringify({ registrationCodeId: codeResult.id });

    await context.env.DB.prepare(
      'INSERT INTO challenges (id, challenge, user_id, type, metadata, expires_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).bind(challengeId, options.challenge, userId, 'registration', metadata, expiresAt).run();

    return jsonResponse({
      success: true,
      data: {
        options,
        userId,
      }
    });
  } catch (error) {
    console.error('Error generating registration options:', error);
    return errorResponse(error instanceof Error ? error.message : 'Failed to generate registration options');
  }
}

export async function onRequestOptions(context: { request: Request }) {
  return handleCors(context.request);
}
