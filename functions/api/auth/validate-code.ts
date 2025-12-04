import { jsonResponse, errorResponse, handleCors, Env } from '../../_lib/utils';

// Validate a registration code (public endpoint)
export async function onRequestGet(context: { request: Request; env: Env }) {
  const corsResponse = handleCors(context.request);
  if (corsResponse) return corsResponse;

  try {
    const url = new URL(context.request.url);
    const code = url.searchParams.get('code');

    if (!code) {
      return jsonResponse({
        success: true,
        data: {
          valid: false,
          reason: 'no_code'
        }
      });
    }

    const result = await context.env.DB.prepare(
      `SELECT id, code, uses_remaining, expires_at
       FROM registration_codes
       WHERE code = ?`
    ).bind(code.toUpperCase()).first();

    if (!result) {
      return jsonResponse({
        success: true,
        data: {
          valid: false,
          reason: 'invalid_code'
        }
      });
    }

    // Check if expired
    if (result.expires_at && new Date(result.expires_at as string) < new Date()) {
      return jsonResponse({
        success: true,
        data: {
          valid: false,
          reason: 'expired'
        }
      });
    }

    // Check if depleted
    if ((result.uses_remaining as number) <= 0) {
      return jsonResponse({
        success: true,
        data: {
          valid: false,
          reason: 'depleted'
        }
      });
    }

    return jsonResponse({
      success: true,
      data: {
        valid: true,
        usesRemaining: result.uses_remaining
      }
    });
  } catch (error) {
    console.error('Error validating registration code:', error);
    return errorResponse('Failed to validate registration code');
  }
}

export async function onRequestOptions(context: { request: Request }) {
  return handleCors(context.request);
}
