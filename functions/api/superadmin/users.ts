import { jsonResponse, errorResponse, handleCors, Env, requireSuperadmin, requireSuperadminPrivilege, generateId, hashPassword } from '../../_lib/utils';

interface SuperadminUserRow {
  id: string;
  username: string;
  display_name: string | null;
  is_superadmin: number;
  created_at: string;
  updated_at: string;
  created_by: string | null;
}

// GET - List all superadmin users
export async function onRequestGet(context: { request: Request; env: Env }) {
  const corsResponse = handleCors(context.request);
  if (corsResponse) return corsResponse;

  // Require superadmin auth
  const authResult = await requireSuperadmin(context.request, context.env.DB);
  if (authResult instanceof Response) return authResult;

  try {
    const result = await context.env.DB.prepare(
      `SELECT id, username, display_name, is_superadmin, created_at, updated_at, created_by
       FROM superadmin_users
       ORDER BY created_at DESC`
    ).all();

    const users = (result.results as unknown as SuperadminUserRow[]).map(u => ({
      id: u.id,
      username: u.username,
      displayName: u.display_name,
      isSuperadmin: u.is_superadmin === 1,
      createdAt: u.created_at,
      updatedAt: u.updated_at,
      createdBy: u.created_by
    }));

    return jsonResponse({
      success: true,
      data: users
    });
  } catch (error) {
    console.error('List superadmin users error:', error);
    return errorResponse('Failed to fetch users');
  }
}

// POST - Create a new superadmin user
export async function onRequestPost(context: { request: Request; env: Env }) {
  const corsResponse = handleCors(context.request);
  if (corsResponse) return corsResponse;

  // Require superadmin privilege to create new admins
  const authResult = await requireSuperadminPrivilege(context.request, context.env.DB);
  if (authResult instanceof Response) return authResult;

  try {
    const body = await context.request.json() as {
      username?: string;
      password?: string;
      displayName?: string;
      isSuperadmin?: boolean;
    };

    if (!body.username || !body.password) {
      return errorResponse('Username and password required', 400);
    }

    // Validate username format
    const usernameRegex = /^[a-z0-9_-]+$/;
    if (!usernameRegex.test(body.username.toLowerCase())) {
      return errorResponse('Username must contain only lowercase letters, numbers, hyphens, and underscores', 400);
    }

    // Check if username already exists
    const existing = await context.env.DB.prepare(
      `SELECT id FROM superadmin_users WHERE username = ?`
    ).bind(body.username.toLowerCase()).first();

    if (existing) {
      return errorResponse('Username already exists', 409);
    }

    // Hash password
    const passwordHash = await hashPassword(body.password);

    // Create user
    const userId = generateId();
    await context.env.DB.prepare(
      `INSERT INTO superadmin_users (id, username, password_hash, display_name, is_superadmin, created_by)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).bind(
      userId,
      body.username.toLowerCase(),
      passwordHash,
      body.displayName || null,
      body.isSuperadmin ? 1 : 0,
      authResult.user.id
    ).run();

    return jsonResponse({
      success: true,
      data: {
        id: userId,
        username: body.username.toLowerCase(),
        displayName: body.displayName || null,
        isSuperadmin: body.isSuperadmin || false
      }
    });
  } catch (error) {
    console.error('Create superadmin user error:', error);
    return errorResponse('Failed to create user');
  }
}

export async function onRequestOptions(context: { request: Request }) {
  return handleCors(context.request);
}
