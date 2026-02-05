import { jsonResponse, errorResponse, handleCors, Env, requireSuperadmin, requireSuperadminPrivilege } from '../../_lib/utils';

interface AppAccessRow {
  id: string;
  user_id: string;
  app_id: string;
  granted_by: string | null;
  created_at: string;
  username?: string;
  display_name?: string;
  app_name?: string;
}

// GET - List all app-user access assignments
export async function onRequestGet(context: { request: Request; env: Env }) {
  const corsResponse = handleCors(context.request);
  if (corsResponse) return corsResponse;

  const authResult = await requireSuperadmin(context.request, context.env.DB);
  if (authResult instanceof Response) return authResult;

  try {
    // Create table if it doesn't exist
    await context.env.DB.prepare(
      `CREATE TABLE IF NOT EXISTS user_app_access (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        app_id TEXT NOT NULL,
        granted_by TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (app_id) REFERENCES apps(id) ON DELETE CASCADE,
        UNIQUE(user_id, app_id)
      )`
    ).run();

    const result = await context.env.DB.prepare(
      `SELECT uaa.*, u.username, u.display_name, a.name as app_name
       FROM user_app_access uaa
       JOIN users u ON uaa.user_id = u.id
       JOIN apps a ON uaa.app_id = a.id
       ORDER BY a.name, u.username`
    ).all();

    return jsonResponse({
      success: true,
      data: result.results as unknown as AppAccessRow[]
    });
  } catch (error) {
    console.error('Get app access error:', error);
    return errorResponse('Failed to fetch app access');
  }
}

// POST - Grant user access to an app
export async function onRequestPost(context: { request: Request; env: Env }) {
  const corsResponse = handleCors(context.request);
  if (corsResponse) return corsResponse;

  const authResult = await requireSuperadminPrivilege(context.request, context.env.DB);
  if (authResult instanceof Response) return authResult;

  try {
    const body = await context.request.json() as {
      user_id: string;
      app_id: string;
    };

    if (!body.user_id || !body.app_id) {
      return errorResponse('user_id and app_id are required', 400);
    }

    // Verify user exists
    const user = await context.env.DB.prepare(
      `SELECT id FROM users WHERE id = ?`
    ).bind(body.user_id).first();
    if (!user) {
      return errorResponse('User not found', 404);
    }

    // Verify app exists
    const app = await context.env.DB.prepare(
      `SELECT id FROM apps WHERE id = ?`
    ).bind(body.app_id).first();
    if (!app) {
      return errorResponse('App not found', 404);
    }

    // Create table if it doesn't exist
    await context.env.DB.prepare(
      `CREATE TABLE IF NOT EXISTS user_app_access (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        app_id TEXT NOT NULL,
        granted_by TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (app_id) REFERENCES apps(id) ON DELETE CASCADE,
        UNIQUE(user_id, app_id)
      )`
    ).run();

    const id = crypto.randomUUID();

    await context.env.DB.prepare(
      `INSERT INTO user_app_access (id, user_id, app_id, granted_by) VALUES (?, ?, ?, ?)`
    ).bind(id, body.user_id, body.app_id, authResult.user.id).run();

    return jsonResponse({
      success: true,
      data: { id, user_id: body.user_id, app_id: body.app_id }
    });
  } catch (error: any) {
    console.error('Grant app access error:', error);
    if (error.message?.includes('UNIQUE constraint failed')) {
      return errorResponse('User already has access to this app', 400);
    }
    return errorResponse('Failed to grant app access');
  }
}

// DELETE - Revoke user access from an app
export async function onRequestDelete(context: { request: Request; env: Env }) {
  const corsResponse = handleCors(context.request);
  if (corsResponse) return corsResponse;

  const authResult = await requireSuperadminPrivilege(context.request, context.env.DB);
  if (authResult instanceof Response) return authResult;

  try {
    const url = new URL(context.request.url);
    const userId = url.searchParams.get('user_id');
    const appId = url.searchParams.get('app_id');

    if (!userId || !appId) {
      return errorResponse('user_id and app_id are required', 400);
    }

    await context.env.DB.prepare(
      `DELETE FROM user_app_access WHERE user_id = ? AND app_id = ?`
    ).bind(userId, appId).run();

    return jsonResponse({
      success: true,
      message: 'Access revoked'
    });
  } catch (error) {
    console.error('Revoke app access error:', error);
    return errorResponse('Failed to revoke app access');
  }
}

export async function onRequestOptions(context: { request: Request }) {
  return handleCors(context.request);
}
