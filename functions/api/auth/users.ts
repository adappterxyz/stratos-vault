import { getSpliceAdminClient, getCantonJsonClient, jsonResponse, errorResponse, handleCors, requireAuth, validateAdminToken, validateSuperadminSession, Env } from '../../_lib/utils';

export async function onRequestGet(context: { request: Request; env: Env }) {
  const corsResponse = handleCors(context.request);
  if (corsResponse) return corsResponse;

  try {
    // Check for admin token first
    const adminToken = context.request.headers.get('X-Admin-Token');
    const superadminToken = context.request.headers.get('X-Superadmin-Token');

    if (adminToken) {
      const isValidAdmin = await validateAdminToken(context.env.DB, adminToken);
      if (!isValidAdmin) {
        return errorResponse('Invalid admin token', 401);
      }
    } else if (superadminToken) {
      const superadminUser = await validateSuperadminSession(context.env.DB, superadminToken);
      if (!superadminUser) {
        return errorResponse('Invalid superadmin token', 401);
      }
    } else {
      // Fall back to regular session auth
      const authResult = await requireAuth(context.request, context.env.DB);
      if (authResult instanceof Response) return authResult;
    }

    // Try the validator's admin API first (returns only users from this node)
    const spliceClient = getSpliceAdminClient(context.env);
    try {
      const nodeUsers = await spliceClient.listUsers();
      if (nodeUsers && nodeUsers.length > 0) {
        const users = nodeUsers.map(u => ({
          username: u.name || u.party_id.split('::')[0],
          displayName: u.name || u.party_id.split('::')[0],
          partyId: u.party_id
        }));

        return jsonResponse({
          success: true,
          data: users
        });
      }
    } catch (spliceError) {
      console.log('Validator admin API failed, falling back to Canton JSON API:', spliceError);
    }

    // Fallback: Use Canton JSON API with participant ID filtering
    const cantonClient = getCantonJsonClient(context.env);
    const allParties = await cantonClient.listParties();

    let localParties;
    try {
      const participantId = await cantonClient.getParticipantId();
      // Extract fingerprint from participant ID (format: "participant::fingerprint")
      const participantFingerprint = participantId.split('::')[1];
      // Filter parties that belong to this participant (party fingerprint matches participant fingerprint)
      localParties = allParties.filter(p => {
        if (!p.isLocal) return false;
        const partyParts = p.party.split('::');
        const partyFingerprint = partyParts[partyParts.length - 1];
        return partyFingerprint === participantFingerprint;
      });
    } catch (err) {
      console.log('Could not get participant ID, using isLocal filter only:', err);
      // Fallback to just isLocal filter if participant ID fetch fails
      localParties = allParties.filter(p => p.isLocal);
    }

    const users = localParties.map(p => ({
      username: p.displayName || p.party.split('::')[0],
      displayName: p.displayName || p.party.split('::')[0],
      partyId: p.party
    }));

    return jsonResponse({
      success: true,
      data: users
    });
  } catch (error) {
    console.error('Error listing users:', error);
    return errorResponse(`Failed to list users: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

export async function onRequestOptions(context: { request: Request }) {
  return handleCors(context.request);
}
