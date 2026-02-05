import { jsonResponse, errorResponse, handleCors, Env, generateId, hashPassword, verifyPassword } from '../../_lib/utils';

// Default superadmin credentials (used on first run if no superadmin exists)
const DEFAULT_SUPERADMIN_USERNAME = 'superadmin';
const DEFAULT_SUPERADMIN_PASSWORD = 'admin123!';

export async function onRequestPost(context: { request: Request; env: Env }) {
  const corsResponse = handleCors(context.request);
  if (corsResponse) return corsResponse;

  try {
    const body = await context.request.json() as { username?: string; password?: string };

    if (!body.username || !body.password) {
      return errorResponse('Username and password required', 400);
    }

    // Check if any superadmin exists, if not, create default one
    const existingAdmin = await context.env.DB.prepare(
      `SELECT COUNT(*) as count FROM superadmin_users`
    ).first();

    if (!existingAdmin || (existingAdmin.count as number) === 0) {
      // Create default superadmin
      const defaultPasswordHash = await hashPassword(DEFAULT_SUPERADMIN_PASSWORD);
      await context.env.DB.prepare(
        `INSERT INTO superadmin_users (id, username, password_hash, is_superadmin, display_name)
         VALUES (?, ?, ?, 1, 'Super Admin')`
      ).bind(generateId(), DEFAULT_SUPERADMIN_USERNAME, defaultPasswordHash).run();
    }

    // Find user by username
    const user = await context.env.DB.prepare(
      `SELECT * FROM superadmin_users WHERE username = ?`
    ).bind(body.username.toLowerCase()).first();

    if (!user) {
      return errorResponse('Invalid credentials', 401);
    }

    // Verify password
    const isValid = await verifyPassword(body.password, user.password_hash as string);
    if (!isValid) {
      return errorResponse('Invalid credentials', 401);
    }

    // Generate session token
    const sessionId = generateId();

    await context.env.DB.prepare(
      `INSERT INTO superadmin_sessions (id, user_id, expires_at) VALUES (?, ?, datetime('now', '+24 hours'))`
    ).bind(sessionId, user.id).run();

    return jsonResponse({
      success: true,
      data: {
        token: sessionId,
        user: {
          id: user.id,
          username: user.username,
          displayName: user.display_name,
          isSuperadmin: user.is_superadmin === 1
        }
      }
    });
  } catch (error) {
    console.error('Superadmin login error:', error);
    return errorResponse('Login failed');
  }
}

export async function onRequestOptions(context: { request: Request }) {
  return handleCors(context.request);
}
