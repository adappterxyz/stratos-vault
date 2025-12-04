import { jsonResponse, errorResponse, handleCors, getCantonJsonClient, requireAdmin, Env } from '../../_lib/utils';

export async function onRequestGet(context: { request: Request; env: Env }) {
  const corsResponse = handleCors(context.request);
  if (corsResponse) return corsResponse;

  try {
    const authResult = await requireAdmin(context.request, context.env.DB);
    if (authResult instanceof Response) return authResult;

    // Get the participant ID for this node to filter users
    const cantonJsonClient = getCantonJsonClient(context.env);
    let participantId: string;

    try {
      participantId = await cantonJsonClient.getParticipantId();
    } catch (err) {
      console.error('Failed to get participant ID:', err);
      // Fallback: return all users if we can't get participant ID
      const users = await context.env.DB.prepare(
        `SELECT id, username, display_name, party_id, role, created_at
         FROM users
         ORDER BY created_at DESC`
      ).all();

      return jsonResponse({
        success: true,
        data: users.results,
        participantId: null
      });
    }

    // Only return users whose party_id belongs to this participant node
    // Users without a party_id are also included (they haven't been assigned yet)
    // Party ID format is "partyHint::fingerprint", participant ID format is "participant::fingerprint"
    // We need to match the fingerprint part
    const participantFingerprint = participantId.split('::')[1];

    // Only return users whose party_id belongs to this participant node
    // Exclude users without party_id (they haven't been assigned to any node)
    const users = await context.env.DB.prepare(
      `SELECT id, username, display_name, party_id, role, created_at
       FROM users
       WHERE party_id IS NOT NULL AND instr(party_id, '::' || ?) > 0
       ORDER BY created_at DESC`
    ).bind(participantFingerprint).all();

    // Extract node name from participant ID (e.g., "participant" from "participant::fingerprint")
    const nodeName = participantId.split('::')[0];

    return jsonResponse({
      success: true,
      data: users.results,
      participantId,
      nodeName
    });
  } catch (error) {
    console.error('Error fetching users:', error);
    return errorResponse(`Failed to fetch users: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

export async function onRequestOptions(context: { request: Request }) {
  return handleCors(context.request);
}
