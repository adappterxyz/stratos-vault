import { generateAuthenticationOptions } from '@simplewebauthn/server';
import { jsonResponse, errorResponse, handleCors, generateId, Env } from '../../../_lib/utils';

export async function onRequestPost(context: { request: Request; env: Env }) {
  const corsResponse = handleCors(context.request);
  if (corsResponse) return corsResponse;

  try {
    const { username } = await context.request.json() as { username?: string };

    let allowCredentials: any[] = [];
    let userId: string | null = null;

    // If username provided, get their passkeys
    if (username) {
      const user = await context.env.DB.prepare(
        'SELECT id FROM users WHERE username = ?'
      ).bind(username).first();

      if (user) {
        userId = user.id as string;
        const passkeys = await context.env.DB.prepare(
          'SELECT credential_id, transports FROM passkeys WHERE user_id = ?'
        ).bind(userId).all();

        allowCredentials = passkeys.results.map((pk: any) => ({
          id: pk.credential_id,
          type: 'public-key' as const,
          transports: JSON.parse(pk.transports || '[]'),
        }));
      }
    }

    // Get RP_ID from request origin
    const origin = context.request.headers.get('origin') || '';
    const rpID = new URL(origin).hostname || context.env.RP_ID;

    // Generate authentication options
    const options = await generateAuthenticationOptions({
      rpID,
      allowCredentials: allowCredentials.length > 0 ? allowCredentials : undefined,
      userVerification: 'required',
    });

    // Store challenge
    const challengeId = generateId();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();

    await context.env.DB.prepare(
      'INSERT INTO challenges (id, challenge, user_id, type, expires_at) VALUES (?, ?, ?, ?, ?)'
    ).bind(challengeId, options.challenge, userId, 'authentication', expiresAt).run();

    // Check which wallet chain types are missing for this user
    const allChainTypes = ['evm', 'svm', 'btc', 'tron', 'ton'];
    let missingChainTypes: string[] = allChainTypes;

    if (userId) {
      const existingWallets = await context.env.DB.prepare(
        'SELECT chain_type FROM wallet_addresses WHERE user_id = ?'
      ).bind(userId).all();

      const existingChainTypes = new Set(existingWallets.results.map((w: any) => w.chain_type));
      missingChainTypes = allChainTypes.filter(ct => !existingChainTypes.has(ct));
    }

    return jsonResponse({
      success: true,
      data: {
        options,
        needsWallets: missingChainTypes.length > 0,
        missingChainTypes
      }
    });
  } catch (error) {
    console.error('Error generating authentication options:', error);
    return errorResponse(error instanceof Error ? error.message : 'Failed to generate authentication options');
  }
}

export async function onRequestOptions(context: { request: Request }) {
  return handleCors(context.request);
}
