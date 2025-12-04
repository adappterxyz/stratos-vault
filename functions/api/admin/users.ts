import { getSpliceAdminClient, getCantonJsonClient, jsonResponse, errorResponse, handleCors, requireAdmin, Env } from '../../_lib/utils';

export async function onRequestPost(context: { request: Request; env: Env }) {
  const corsResponse = handleCors(context.request);
  if (corsResponse) return corsResponse;

  try {
    const authResult = await requireAdmin(context.request, context.env.DB);
    if (authResult instanceof Response) return authResult;

    const { username, displayName } = await context.request.json() as { username: string; displayName?: string };

    if (!username) {
      return errorResponse('Missing required field: username', 400);
    }

    const finalDisplayName = displayName || username;
    const cantonJsonClient = getCantonJsonClient(context.env);

    let partyId: string;

    try {
      console.log(`Creating party for user: ${username}`);
      const partyDetails = await cantonJsonClient.allocateParty(username, finalDisplayName);
      console.log(`allocateParty returned:`, JSON.stringify(partyDetails));
      partyId = partyDetails.party;
      console.log(`Party allocated, partyId: ${partyId}`);

      // If partyId is empty after allocation, something went wrong with response parsing
      if (!partyId) {
        console.log('Warning: allocateParty returned empty party, checking if party was created...');
        // Check if the party was actually created by listing parties
        const parties = await cantonJsonClient.listParties();
        const participantId = await cantonJsonClient.getParticipantId();
        const participantFingerprint = participantId.split('::')[1];
        console.log(`Participant fingerprint: ${participantFingerprint}`);
        console.log(`All parties:`, JSON.stringify(parties.map(p => p.party)));

        const newlyCreatedParty = parties.find(p => {
          const parts = p.party.split('::');
          return parts[0] === username && parts[1] === participantFingerprint;
        });

        if (newlyCreatedParty) {
          partyId = newlyCreatedParty.party;
          console.log(`Found newly created party via list: ${partyId}`);
        } else {
          throw new Error(`Party allocation returned empty partyId and party not found in list`);
        }
      }

      console.log(`Creating Canton user: ${username}`);
      await cantonJsonClient.createUser(username, partyId, finalDisplayName);

      console.log(`Granting rights to user: ${username}`);
      await cantonJsonClient.grantRights(username, partyId);

      console.log(`Onboarding user to Splice: ${username}`);
      const spliceAdminClient = getSpliceAdminClient(context.env);
      await spliceAdminClient.onboardUser(partyId, username);
    } catch (error: any) {
      console.log('Caught error in inner catch:', error.message);

      // Check if party already exists on THIS node
      const parties = await cantonJsonClient.listParties();
      const participantId = await cantonJsonClient.getParticipantId();
      const participantFingerprint = participantId.split('::')[1];

      // Look for party with this username belonging to this node (matching fingerprint)
      const existingParty = parties.find(p => {
        const parts = p.party.split('::');
        return parts[0] === username && parts[1] === participantFingerprint;
      });

      if (existingParty) {
        // Party exists on this node - use it
        partyId = existingParty.party;
        console.log(`Found existing party on this node: ${partyId}`);
      } else {
        // Party doesn't exist on this node - re-throw the original error
        console.log(`Party not found on this node, original error: ${error.message}`);
        throw error;
      }
    }

    // Update database user record with party_id if user exists
    try {
      await context.env.DB.prepare(
        'UPDATE users SET party_id = ? WHERE username = ? AND party_id IS NULL'
      ).bind(partyId, username).run();
      console.log(`Database user record updated with party_id for: ${username}`);
    } catch (dbError) {
      console.log('Failed to update database (user may not exist yet):', dbError);
    }

    return jsonResponse({
      success: true,
      data: {
        username,
        partyId,
        displayName: finalDisplayName
      }
    });
  } catch (error) {
    console.error('Error creating user:', error);
    return errorResponse(error instanceof Error ? error.message : 'Failed to create user');
  }
}

export async function onRequestOptions(context: { request: Request }) {
  return handleCors(context.request);
}
