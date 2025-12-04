import { jsonResponse, errorResponse, handleCors, requireAdmin, generateId, Env } from '../../_lib/utils';

interface CodeInput {
  maxUses: number;
  expiresAt?: string;
}

// Generate a random registration code
function generateCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Removed ambiguous characters
  let code = '';
  for (let i = 0; i < 8; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

// Get all registration codes
export async function onRequestGet(context: { request: Request; env: Env }) {
  const corsResponse = handleCors(context.request);
  if (corsResponse) return corsResponse;

  try {
    const authResult = await requireAdmin(context.request, context.env.DB);
    if (authResult instanceof Response) return authResult;

    const result = await context.env.DB.prepare(
      `SELECT rc.*, u.username as created_by_username,
              (SELECT COUNT(*) FROM registration_code_uses WHERE code_id = rc.id) as total_uses
       FROM registration_codes rc
       LEFT JOIN users u ON rc.created_by = u.id
       ORDER BY rc.created_at DESC`
    ).all();

    const codes = (result.results || []).map((row: any) => ({
      id: row.id,
      code: row.code,
      maxUses: row.max_uses,
      usesRemaining: row.uses_remaining,
      totalUses: row.total_uses,
      createdBy: row.created_by_username || null,
      expiresAt: row.expires_at,
      createdAt: row.created_at,
      isExpired: row.expires_at ? new Date(row.expires_at) < new Date() : false,
      isDepleted: row.uses_remaining <= 0
    }));

    return jsonResponse({
      success: true,
      data: codes
    });
  } catch (error) {
    console.error('Error fetching registration codes:', error);
    return errorResponse('Failed to fetch registration codes');
  }
}

// Create new registration code
export async function onRequestPost(context: { request: Request; env: Env }) {
  const corsResponse = handleCors(context.request);
  if (corsResponse) return corsResponse;

  try {
    const authResult = await requireAdmin(context.request, context.env.DB);
    if (authResult instanceof Response) return authResult;

    const body = await context.request.json() as CodeInput;

    if (!body.maxUses || body.maxUses < 1) {
      return errorResponse('maxUses must be at least 1', 400);
    }

    const id = generateId();
    const code = generateCode();

    // Get admin user ID from session if available
    const adminToken = context.request.headers.get('X-Admin-Token');
    let createdBy: string | null = null;

    if (adminToken) {
      const session = await context.env.DB.prepare(
        'SELECT user_id FROM sessions WHERE id = ? AND expires_at > datetime("now")'
      ).bind(adminToken).first();
      if (session) {
        createdBy = session.user_id as string;
      }
    }

    await context.env.DB.prepare(
      `INSERT INTO registration_codes (id, code, max_uses, uses_remaining, created_by, expires_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).bind(
      id,
      code,
      body.maxUses,
      body.maxUses,
      createdBy,
      body.expiresAt || null
    ).run();

    return jsonResponse({
      success: true,
      data: {
        id,
        code,
        maxUses: body.maxUses,
        usesRemaining: body.maxUses,
        expiresAt: body.expiresAt || null
      }
    });
  } catch (error: any) {
    console.error('Error creating registration code:', error);
    return errorResponse('Failed to create registration code');
  }
}

export async function onRequestOptions(context: { request: Request }) {
  return handleCors(context.request);
}
