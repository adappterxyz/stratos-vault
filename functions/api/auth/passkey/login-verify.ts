import { verifyAuthenticationResponse } from '@simplewebauthn/server';
import { jsonResponse, errorResponse, handleCors, generateId, Env } from '../../../_lib/utils';

export async function onRequestPost(context: { request: Request; env: Env }) {
  const corsResponse = handleCors(context.request);
  if (corsResponse) return corsResponse;

  try {
    const { response, walletAddresses } = await context.request.json() as {
      response: any;
      walletAddresses?: Array<{
        chainType: string;
        address: string;
        privateKeyEncrypted: string;
      }>;
    };

    if (!response) {
      return errorResponse('response is required', 400);
    }

    // Find the passkey by credential ID
    const credentialId = response.id;
    const passkey = await context.env.DB.prepare(
      'SELECT p.*, u.id as user_id, u.username, u.display_name, u.party_id, u.role FROM passkeys p JOIN users u ON p.user_id = u.id WHERE p.credential_id = ?'
    ).bind(credentialId).first();

    if (!passkey) {
      return errorResponse('Passkey not found', 400);
    }

    // Get the stored challenge
    const challenge = await context.env.DB.prepare(
      'SELECT challenge FROM challenges WHERE type = ? AND expires_at > datetime("now") ORDER BY created_at DESC LIMIT 1'
    ).bind('authentication').first();

    if (!challenge) {
      return errorResponse('Challenge expired or not found', 400);
    }

    const expectedChallenge = challenge.challenge as string;

    // Get RP_ID from request origin
    const origin = context.request.headers.get('origin') || `https://${context.env.RP_ID}`;
    const rpID = new URL(origin).hostname;

    // Verify the authentication response
    const verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      credential: {
        id: passkey.credential_id as string,
        publicKey: Uint8Array.from(Buffer.from(passkey.public_key as string, 'base64')),
        counter: passkey.counter as number,
      },
      requireUserVerification: false,
    });

    if (!verification.verified) {
      return errorResponse('Verification failed', 400);
    }

    // Update counter
    await context.env.DB.prepare(
      'UPDATE passkeys SET counter = ?, last_used_at = datetime("now") WHERE id = ?'
    ).bind(verification.authenticationInfo.newCounter, passkey.id).run();

    // Clean up old challenges
    await context.env.DB.prepare(
      'DELETE FROM challenges WHERE expires_at < datetime("now")'
    ).run();

    // Store client-generated wallet addresses if provided
    if (walletAddresses && walletAddresses.length > 0) {
      console.log(`Storing ${walletAddresses.length} client-generated wallet addresses for user: ${passkey.user_id}`);
      for (const wallet of walletAddresses) {
        const walletId = generateId();
        try {
          await context.env.DB.prepare(
            `INSERT INTO wallet_addresses (id, user_id, chain_type, address, private_key_encrypted)
             VALUES (?, ?, ?, ?, ?)
             ON CONFLICT(user_id, chain_type) DO NOTHING`
          ).bind(
            walletId,
            passkey.user_id,
            wallet.chainType,
            wallet.address,
            wallet.privateKeyEncrypted
          ).run();
        } catch (e) {
          // Ignore duplicate key errors
          console.log(`Wallet for ${wallet.chainType} already exists, skipping`);
        }
      }
    }

    // Create session
    const sessionId = generateId();
    const sessionExpires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

    await context.env.DB.prepare(
      'INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)'
    ).bind(sessionId, passkey.user_id, sessionExpires).run();

    return jsonResponse({
      success: true,
      data: {
        verified: true,
        sessionId,
        user: {
          id: passkey.user_id,
          username: passkey.username,
          displayName: passkey.display_name,
          partyId: passkey.party_id,
          role: passkey.role || 'user'
        }
      }
    });
  } catch (error) {
    console.error('Error verifying authentication:', error);
    return errorResponse(error instanceof Error ? error.message : 'Failed to verify authentication');
  }
}

export async function onRequestOptions(context: { request: Request }) {
  return handleCors(context.request);
}
