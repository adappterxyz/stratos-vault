import { jsonResponse, errorResponse, handleCors, Env } from '../../_lib/utils';

const ADMIN_PASSWORD = 'password!';

export async function onRequestPost(context: { request: Request; env: Env }) {
  const corsResponse = handleCors(context.request);
  if (corsResponse) return corsResponse;

  try {
    const body = await context.request.json() as { password?: string };

    if (!body.password) {
      return errorResponse('Password required', 400);
    }

    if (body.password !== ADMIN_PASSWORD) {
      return errorResponse('Invalid password', 401);
    }

    // Generate a simple admin token (in production, use proper JWT)
    const adminToken = crypto.randomUUID();

    // Store admin session in DB
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours
    await context.env.DB.prepare(
      `INSERT INTO admin_sessions (id, expires_at) VALUES (?, ?)`
    ).bind(adminToken, expiresAt.toISOString()).run();

    return jsonResponse({
      success: true,
      data: { token: adminToken }
    });
  } catch (error) {
    console.error('Admin login error:', error);
    return errorResponse('Login failed');
  }
}

export async function onRequestOptions(context: { request: Request }) {
  return handleCors(context.request);
}
