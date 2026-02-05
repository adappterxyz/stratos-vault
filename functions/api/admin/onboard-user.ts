/**
 * Admin endpoint to manually onboard a user to Splice
 * POST /api/admin/onboard-user
 *
 * This is useful when:
 * - Splice onboarding failed during registration
 * - Canton network was reset and parties need to be re-onboarded
 * - Testing/debugging party connectivity issues
 */

import { getSpliceAdminClient, jsonResponse, errorResponse, handleCors, requireAdmin, Env } from '../../_lib/utils';

export async function onRequestPost(context: { request: Request; env: Env }) {
  const corsResponse = handleCors(context.request);
  if (corsResponse) return corsResponse;

  try {
    // Require admin access
    const adminCheck = await requireAdmin(context.request, context.env.DB);
    if (adminCheck instanceof Response) return adminCheck;

    const { userId, partyId, username } = await context.request.json() as {
      userId?: string;
      partyId?: string;
      username?: string;
    };

    // If userId provided, look up the user
    let targetPartyId = partyId;
    let targetUsername = username;

    if (userId && !partyId) {
      const user = await context.env.DB.prepare(
        'SELECT username, party_id FROM users WHERE id = ?'
      ).bind(userId).first();

      if (!user) {
        return errorResponse('User not found', 404);
      }

      targetPartyId = user.party_id as string;
      targetUsername = user.username as string;
    }

    if (!targetPartyId || !targetUsername) {
      return errorResponse('Either userId or both partyId and username are required', 400);
    }

    console.log(`Manually onboarding user to Splice: ${targetUsername} (${targetPartyId})`);

    // Onboard to Splice
    const spliceAdminClient = getSpliceAdminClient(context.env);

    try {
      await spliceAdminClient.onboardUser(targetPartyId, targetUsername);
      console.log(`User successfully onboarded to Splice: ${targetUsername}`);

      return jsonResponse({
        success: true,
        data: {
          message: 'User onboarded to Splice successfully',
          partyId: targetPartyId,
          username: targetUsername
        }
      });
    } catch (spliceError: any) {
      console.error('Splice onboarding failed:', spliceError);
      return jsonResponse({
        success: false,
        error: `Splice onboarding failed: ${spliceError.message}`,
        details: {
          partyId: targetPartyId,
          username: targetUsername,
          spliceHost: context.env.SPLICE_HOST
        }
      }, 500);
    }

  } catch (error) {
    console.error('Error in onboard-user:', error);
    return errorResponse(error instanceof Error ? error.message : 'Failed to onboard user');
  }
}

export async function onRequestOptions(context: { request: Request }) {
  return handleCors(context.request);
}
