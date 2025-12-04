import { verifyRegistrationResponse } from '@simplewebauthn/server';
import { jsonResponse, errorResponse, handleCors, generateId, Env, getCantonJsonClient, getSpliceAdminClient } from '../../../_lib/utils';
import { generateWalletAddresses, storeWalletAddresses } from '../../../_lib/wallet-generator';

export async function onRequestPost(context: { request: Request; env: Env }) {
  const corsResponse = handleCors(context.request);
  if (corsResponse) return corsResponse;

  try {
    const { userId, response, prfEnabled, walletAddresses } = await context.request.json() as {
      userId: string;
      response: any;
      prfEnabled?: boolean;
      walletAddresses?: Array<{
        chainType: string;
        address: string;
        privateKeyEncrypted: string;
      }>;
    };

    if (!userId || !response) {
      return errorResponse('userId and response are required', 400);
    }

    // Get the stored challenge with metadata
    const challenge = await context.env.DB.prepare(
      'SELECT challenge, metadata FROM challenges WHERE user_id = ? AND type = ? AND expires_at > datetime("now") ORDER BY created_at DESC LIMIT 1'
    ).bind(userId, 'registration').first();

    if (!challenge) {
      return errorResponse('Challenge expired or not found', 400);
    }

    const expectedChallenge = challenge.challenge as string;

    // Parse metadata to get registration code ID
    let registrationCodeId: string | null = null;
    if (challenge.metadata) {
      try {
        const metadata = JSON.parse(challenge.metadata as string);
        registrationCodeId = metadata.registrationCodeId || null;
      } catch (e) {
        console.error('Failed to parse challenge metadata:', e);
      }
    }

    // Validate registration code is still valid
    if (registrationCodeId) {
      const codeResult = await context.env.DB.prepare(
        `SELECT id, uses_remaining, expires_at FROM registration_codes WHERE id = ?`
      ).bind(registrationCodeId).first();

      if (!codeResult) {
        return errorResponse('Registration code no longer exists', 400);
      }

      if (codeResult.expires_at && new Date(codeResult.expires_at as string) < new Date()) {
        return errorResponse('Registration code has expired', 400);
      }

      if ((codeResult.uses_remaining as number) <= 0) {
        return errorResponse('Registration code has been fully used', 400);
      }
    }

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

    const { credential, credentialDeviceType, credentialBackedUp } = verification.registrationInfo;

    // Store the passkey
    // Note: credential.id is already a Base64URLString, store it directly
    const passkeyId = generateId();
    await context.env.DB.prepare(
      `INSERT INTO passkeys (id, user_id, credential_id, public_key, counter, device_type, backed_up, transports)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      passkeyId,
      userId,
      credential.id,  // Already base64url encoded
      Buffer.from(credential.publicKey).toString('base64'),
      credential.counter,
      credentialDeviceType,
      credentialBackedUp ? 1 : 0,
      JSON.stringify(credential.transports || [])
    ).run();

    // Clean up used challenge
    await context.env.DB.prepare(
      'DELETE FROM challenges WHERE user_id = ? AND type = ?'
    ).bind(userId, 'registration').run();

    // Consume the registration code
    if (registrationCodeId) {
      // Decrement uses_remaining
      await context.env.DB.prepare(
        'UPDATE registration_codes SET uses_remaining = uses_remaining - 1 WHERE id = ? AND uses_remaining > 0'
      ).bind(registrationCodeId).run();

      // Log the usage
      const useLogId = generateId();
      await context.env.DB.prepare(
        'INSERT INTO registration_code_uses (id, code_id, user_id) VALUES (?, ?, ?)'
      ).bind(useLogId, registrationCodeId, userId).run();
    }

    // Handle wallet addresses
    // If client provided PRF-encrypted wallets, store those
    // Otherwise, fall back to server-side generation (for non-PRF authenticators)
    if (walletAddresses && walletAddresses.length > 0) {
      // Store client-generated wallet addresses (PRF-encrypted)
      console.log(`Storing ${walletAddresses.length} client-generated wallet addresses for user: ${userId}`);
      for (const wallet of walletAddresses) {
        const walletId = generateId();
        await context.env.DB.prepare(
          `INSERT INTO wallet_addresses (id, user_id, chain_type, address, private_key_encrypted)
           VALUES (?, ?, ?, ?, ?)`
        ).bind(
          walletId,
          userId,
          wallet.chainType,
          wallet.address,
          wallet.privateKeyEncrypted
        ).run();
      }
    } else if (!prfEnabled) {
      // PRF not enabled - generate server-side (legacy/fallback)
      // Note: These can be decrypted by the server
      try {
        console.log(`PRF not available, generating server-side wallet addresses for user: ${userId}`);
        const encryptionKey = context.env.CANTON_AUTH_SECRET || 'default-encryption-key';
        const serverWallets = await generateWalletAddresses(encryptionKey);
        await storeWalletAddresses(context.env.DB, userId, serverWallets);
        console.log(`Generated ${serverWallets.length} server-side wallet addresses for user: ${userId}`);
      } catch (walletError) {
        console.error('Failed to generate wallet addresses:', walletError);
        // Don't fail registration if wallet generation fails
      }
    } else {
      // PRF enabled but no wallets provided - they'll be generated on first login
      console.log(`PRF enabled for user ${userId}, wallets will be generated on first login`);
    }

    // Check if this is the first user - make them admin
    const userCount = await context.env.DB.prepare(
      'SELECT COUNT(*) as count FROM passkeys'
    ).first();

    if (userCount && (userCount.count as number) === 1) {
      // First passkey registered, make this user admin
      await context.env.DB.prepare(
        'UPDATE users SET role = ? WHERE id = ?'
      ).bind('admin', userId).run();
    }

    // Get user info to get username for party creation
    const user = await context.env.DB.prepare(
      'SELECT username, display_name, party_id, role FROM users WHERE id = ?'
    ).bind(userId).first();

    const username = user?.username as string;
    const displayName = (user?.display_name || username) as string;
    let partyId = user?.party_id as string | null;

    // Create Canton party for the user if they don't have one
    if (!partyId && username) {
      try {
        console.log(`Creating Canton party for new user: ${username}`);
        const cantonJsonClient = getCantonJsonClient(context.env);

        // Allocate party
        const partyDetails = await cantonJsonClient.allocateParty(username, displayName);
        partyId = partyDetails.party;
        console.log(`Party allocated: ${partyId}`);

        // Create Canton user
        await cantonJsonClient.createUser(username, partyId, displayName);
        console.log(`Canton user created: ${username}`);

        // Grant rights
        await cantonJsonClient.grantRights(username, partyId);
        console.log(`Rights granted to: ${username}`);

        // Onboard to Splice
        const spliceAdminClient = getSpliceAdminClient(context.env);
        await spliceAdminClient.onboardUser(partyId, username);
        console.log(`User onboarded to Splice: ${username}`);

        // Update user record with party_id
        await context.env.DB.prepare(
          'UPDATE users SET party_id = ? WHERE id = ?'
        ).bind(partyId, userId).run();
        console.log(`User record updated with party_id: ${partyId}`);
      } catch (partyError: any) {
        // Log error but don't fail registration - party can be created later
        console.error('Failed to create Canton party during registration:', partyError);
        // Party creation failed, but passkey is registered - user can still login
      }
    }

    // Create session
    const sessionId = generateId();
    const sessionExpires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(); // 7 days

    await context.env.DB.prepare(
      'INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)'
    ).bind(sessionId, userId, sessionExpires).run();

    const userRole = (userCount && (userCount.count as number) === 1) ? 'admin' : (user?.role || 'user');

    return jsonResponse({
      success: true,
      data: {
        verified: true,
        sessionId,
        user: {
          id: userId,
          username: username,
          displayName: displayName,
          partyId: partyId,
          role: userRole
        }
      }
    });
  } catch (error) {
    console.error('Error verifying registration:', error);
    return errorResponse(error instanceof Error ? error.message : 'Failed to verify registration');
  }
}

export async function onRequestOptions(context: { request: Request }) {
  return handleCors(context.request);
}
