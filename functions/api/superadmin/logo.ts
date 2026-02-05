import { jsonResponse, errorResponse, handleCors, Env, requireSuperadminPrivilege } from '../../_lib/utils';

const MAX_LOGO_SIZE = 256 * 1024; // 256KB max

// GET - Get current logo
export async function onRequestGet(context: { request: Request; env: Env }) {
  const corsResponse = handleCors(context.request);
  if (corsResponse) return corsResponse;

  try {
    const result = await context.env.DB.prepare(
      `SELECT value FROM config_overrides WHERE key = 'LOGO'`
    ).first<{ value: string }>();

    return jsonResponse({
      success: true,
      data: { logo: result?.value || null }
    });
  } catch (error) {
    console.error('Get logo error:', error);
    return errorResponse('Failed to fetch logo');
  }
}

// PUT - Upload logo (base64)
export async function onRequestPut(context: { request: Request; env: Env }) {
  const corsResponse = handleCors(context.request);
  if (corsResponse) return corsResponse;

  const authResult = await requireSuperadminPrivilege(context.request, context.env.DB);
  if (authResult instanceof Response) return authResult;

  try {
    const body = await context.request.json() as { logo: string };

    if (!body.logo) {
      return errorResponse('Logo data required', 400);
    }

    // Validate it's a data URL
    if (!body.logo.startsWith('data:image/')) {
      return errorResponse('Invalid image format', 400);
    }

    // Check size (base64 string length)
    if (body.logo.length > MAX_LOGO_SIZE * 1.4) { // base64 is ~1.37x larger
      return errorResponse('Logo too large (max 256KB)', 400);
    }

    await context.env.DB.prepare(
      `INSERT INTO config_overrides (key, value, updated_at, updated_by)
       VALUES ('LOGO', ?, datetime('now'), ?)
       ON CONFLICT(key) DO UPDATE SET
         value = excluded.value,
         updated_at = datetime('now'),
         updated_by = excluded.updated_by`
    ).bind(body.logo, authResult.user.id).run();

    return jsonResponse({ success: true });
  } catch (error) {
    console.error('Upload logo error:', error);
    return errorResponse('Failed to upload logo');
  }
}

// DELETE - Remove custom logo (revert to default)
export async function onRequestDelete(context: { request: Request; env: Env }) {
  const corsResponse = handleCors(context.request);
  if (corsResponse) return corsResponse;

  const authResult = await requireSuperadminPrivilege(context.request, context.env.DB);
  if (authResult instanceof Response) return authResult;

  try {
    await context.env.DB.prepare(
      `DELETE FROM config_overrides WHERE key = 'LOGO'`
    ).run();

    return jsonResponse({ success: true, message: 'Logo reset to default' });
  } catch (error) {
    console.error('Delete logo error:', error);
    return errorResponse('Failed to reset logo');
  }
}

export async function onRequestOptions(context: { request: Request }) {
  return handleCors(context.request);
}
