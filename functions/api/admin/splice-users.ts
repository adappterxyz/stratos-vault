/**
 * Admin endpoint to list Splice users
 * GET /api/admin/splice-users
 *
 * Returns the list of users onboarded to Splice validator
 */

import { getSpliceAdminClient, jsonResponse, errorResponse, handleCors, requireAdmin, Env } from '../../_lib/utils';

export async function onRequestGet(context: { request: Request; env: Env }) {
  const corsResponse = handleCors(context.request);
  if (corsResponse) return corsResponse;

  try {
    // Require admin access
    const adminCheck = await requireAdmin(context.request, context.env.DB);
    if (adminCheck instanceof Response) return adminCheck;

    console.log(`Fetching Splice users from ${context.env.SPLICE_HOST}`);

    const spliceAdminClient = getSpliceAdminClient(context.env);

    try {
      const users = await spliceAdminClient.listUsers();
      console.log(`Found ${users.length} Splice users`);

      return jsonResponse({
        success: true,
        data: {
          spliceHost: context.env.SPLICE_HOST,
          userCount: users.length,
          users: users
        }
      });
    } catch (spliceError: any) {
      console.error('Failed to list Splice users:', spliceError);
      return jsonResponse({
        success: false,
        error: `Failed to list Splice users: ${spliceError.message}`,
        details: {
          spliceHost: context.env.SPLICE_HOST
        }
      }, 500);
    }

  } catch (error) {
    console.error('Error in splice-users:', error);
    return errorResponse(error instanceof Error ? error.message : 'Failed to list users');
  }
}

export async function onRequestOptions(context: { request: Request }) {
  return handleCors(context.request);
}
