import { jsonResponse, errorResponse, handleCors, requireAuth, Env } from '../../_lib/utils';

async function ensureNameColumn(db: D1Database) {
  try {
    await db.prepare("SELECT name FROM passkeys LIMIT 0").all();
  } catch {
    await db.prepare("ALTER TABLE passkeys ADD COLUMN name TEXT").run();
  }
}

// GET - List user's passkeys
export async function onRequestGet(context: { request: Request; env: Env }) {
  const corsResponse = handleCors(context.request);
  if (corsResponse) return corsResponse;

  try {
    const authResult = await requireAuth(context.request, context.env.DB);
    if (authResult instanceof Response) return authResult;
    const { user } = authResult;

    await ensureNameColumn(context.env.DB);

    const result = await context.env.DB.prepare(
      `SELECT id, credential_id, device_type, backed_up, transports, name, created_at
       FROM passkeys
       WHERE user_id = ?
       ORDER BY created_at ASC`
    ).bind(user.id).all();

    const passkeys = (result.results || []).map((row: any, index: number) => ({
      id: row.id,
      name: row.name || `Passkey ${index + 1}`,
      deviceType: row.device_type,
      backedUp: row.backed_up === 1,
      transports: JSON.parse(row.transports || '[]'),
      createdAt: row.created_at,
    }));

    return jsonResponse({
      success: true,
      data: passkeys
    });
  } catch (error) {
    console.error('Error fetching passkeys:', error);
    return errorResponse('Failed to fetch passkeys');
  }
}

// DELETE - Remove a passkey
export async function onRequestDelete(context: { request: Request; env: Env }) {
  const corsResponse = handleCors(context.request);
  if (corsResponse) return corsResponse;

  try {
    const authResult = await requireAuth(context.request, context.env.DB);
    if (authResult instanceof Response) return authResult;
    const { user } = authResult;

    const url = new URL(context.request.url);
    const passkeyId = url.searchParams.get('id');

    if (!passkeyId) {
      return errorResponse('Passkey ID is required', 400);
    }

    // Verify the passkey belongs to this user
    const passkey = await context.env.DB.prepare(
      'SELECT id FROM passkeys WHERE id = ? AND user_id = ?'
    ).bind(passkeyId, user.id).first();

    if (!passkey) {
      return errorResponse('Passkey not found', 404);
    }

    // Prevent deleting the last passkey
    const count = await context.env.DB.prepare(
      'SELECT COUNT(*) as count FROM passkeys WHERE user_id = ?'
    ).bind(user.id).first();

    if (count && (count.count as number) <= 1) {
      return errorResponse('Cannot delete your last passkey', 400);
    }

    await context.env.DB.prepare(
      'DELETE FROM passkeys WHERE id = ? AND user_id = ?'
    ).bind(passkeyId, user.id).run();

    return jsonResponse({
      success: true,
      data: { deleted: true }
    });
  } catch (error) {
    console.error('Error deleting passkey:', error);
    return errorResponse('Failed to delete passkey');
  }
}

export async function onRequestOptions(context: { request: Request }) {
  return handleCors(context.request);
}
