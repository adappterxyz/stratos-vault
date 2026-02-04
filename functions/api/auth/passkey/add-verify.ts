import { verifyRegistrationResponse } from '@simplewebauthn/server';
import { jsonResponse, errorResponse, handleCors, generateId, requireAuth, Env } from '../../../_lib/utils';

export async function onRequestPost(context: { request: Request; env: Env }) {
  const corsResponse = handleCors(context.request);
  if (corsResponse) return corsResponse;

  try {
    const authResult = await requireAuth(context.request, context.env.DB);
    if (authResult instanceof Response) return authResult;
    const { user } = authResult;

    const { response, name } = await context.request.json() as {
      response: any;
      name?: string;
    };

    if (!response) {
      return errorResponse('response is required', 400);
    }

    // Get the stored challenge for add_passkey
    const challenge = await context.env.DB.prepare(
      'SELECT id, challenge FROM challenges WHERE user_id = ? AND type = ? AND expires_at > datetime("now") ORDER BY created_at DESC LIMIT 1'
    ).bind(user.id, 'add_passkey').first();

    if (!challenge) {
      return errorResponse('Challenge expired or not found', 400);
    }

    const expectedChallenge = challenge.challenge as string;

    // Get RP_ID from request origin
    const origin = context.request.headers.get('origin') || `https://${context.env.RP_ID}`;
    const rpID = new URL(origin).hostname;

    // Verify the registration response
    const verification = await verifyRegistrationResponse({
      response,
      expectedChallenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      requireUserVerification: false,
    });

    if (!verification.verified || !verification.registrationInfo) {
      return errorResponse('Verification failed', 400);
    }

    // Race condition guard: re-check count < 5
    const countResult = await context.env.DB.prepare(
      'SELECT COUNT(*) as count FROM passkeys WHERE user_id = ?'
    ).bind(user.id).first();

    if (countResult && (countResult.count as number) >= 5) {
      return errorResponse('Maximum of 5 passkeys allowed', 400);
    }

    const { credential, credentialDeviceType, credentialBackedUp } = verification.registrationInfo;

    // Store the passkey
    const passkeyId = generateId();
    const passkeyName = name?.trim() || null;
    await context.env.DB.prepare(
      `INSERT INTO passkeys (id, user_id, credential_id, public_key, counter, device_type, backed_up, transports, name)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      passkeyId,
      user.id,
      credential.id,
      Buffer.from(credential.publicKey).toString('base64'),
      credential.counter,
      credentialDeviceType,
      credentialBackedUp ? 1 : 0,
      JSON.stringify(credential.transports || []),
      passkeyName
    ).run();

    // Clean up used challenge
    await context.env.DB.prepare(
      'DELETE FROM challenges WHERE id = ?'
    ).bind(challenge.id).run();

    return jsonResponse({
      success: true,
      data: {
        id: passkeyId,
        deviceType: credentialDeviceType,
        backedUp: credentialBackedUp,
      }
    });
  } catch (error) {
    console.error('Error verifying add-passkey:', error);
    return errorResponse(error instanceof Error ? error.message : 'Failed to verify passkey');
  }
}

export async function onRequestOptions(context: { request: Request }) {
  return handleCors(context.request);
}
