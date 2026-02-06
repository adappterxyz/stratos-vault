import { jsonResponse, errorResponse, handleCors, Env, requireSuperadmin, requireSuperadminPrivilege } from '../../_lib/utils';

interface AppRow {
  id: string;
  name: string;
  icon: string;
  color: string;
  url: string | null;
  zoom: number;
  sort_order: number;
  is_enabled: number;
  created_at: string;
  updated_at: string;
}

// GET - List all apps
export async function onRequestGet(context: { request: Request; env: Env }) {
  const corsResponse = handleCors(context.request);
  if (corsResponse) return corsResponse;

  // Require superadmin auth
  const authResult = await requireSuperadmin(context.request, context.env.DB);
  if (authResult instanceof Response) return authResult;

  try {
    const result = await context.env.DB.prepare(
      `SELECT * FROM apps ORDER BY sort_order, name`
    ).all();

    return jsonResponse({
      success: true,
      data: result.results as unknown as AppRow[]
    });
  } catch (error) {
    console.error('Get apps error:', error);
    return errorResponse('Failed to fetch apps');
  }
}

// POST - Add new app
export async function onRequestPost(context: { request: Request; env: Env }) {
  const corsResponse = handleCors(context.request);
  if (corsResponse) return corsResponse;

  // Require superadmin privilege
  const authResult = await requireSuperadminPrivilege(context.request, context.env.DB);
  if (authResult instanceof Response) return authResult;

  try {
    const body = await context.request.json() as {
      id?: string;
      name: string;
      icon: string;
      color?: string;
      url?: string;
      zoom?: number;
      sort_order?: number;
      is_enabled?: boolean;
    };

    // Validate required fields
    if (!body.name || !body.icon) {
      return errorResponse('name and icon are required', 400);
    }

    // Validate URL format if provided
    if (body.url) {
      try {
        new URL(body.url);
      } catch {
        return errorResponse('Invalid URL format', 400);
      }
    }

    // Validate color format if provided
    if (body.color && !/^#[0-9A-Fa-f]{6}$/.test(body.color)) {
      return errorResponse('Invalid color format. Use hex format like #6366f1', 400);
    }

    const id = body.id || crypto.randomUUID();
    const color = body.color || '#6366f1';
    const zoom = Math.min(200, Math.max(10, body.zoom ?? 100));
    const sortOrder = body.sort_order ?? 0;
    const isEnabled = body.is_enabled !== false ? 1 : 0;

    await context.env.DB.prepare(
      `INSERT INTO apps (id, name, icon, color, url, zoom, sort_order, is_enabled)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(id, body.name, body.icon, color, body.url || null, zoom, sortOrder, isEnabled).run();

    // Fetch the created app
    const created = await context.env.DB.prepare(
      `SELECT * FROM apps WHERE id = ?`
    ).bind(id).first<AppRow>();

    return jsonResponse({
      success: true,
      data: created
    });
  } catch (error: any) {
    console.error('Create app error:', error);
    if (error.message?.includes('UNIQUE constraint failed')) {
      return errorResponse('An app with this ID already exists', 400);
    }
    return errorResponse('Failed to create app');
  }
}

// PUT - Update app
export async function onRequestPut(context: { request: Request; env: Env }) {
  const corsResponse = handleCors(context.request);
  if (corsResponse) return corsResponse;

  // Require superadmin privilege
  const authResult = await requireSuperadminPrivilege(context.request, context.env.DB);
  if (authResult instanceof Response) return authResult;

  try {
    const url = new URL(context.request.url);
    const id = url.searchParams.get('id');

    if (!id) {
      return errorResponse('App ID required', 400);
    }

    const body = await context.request.json() as {
      name?: string;
      icon?: string;
      color?: string;
      url?: string | null;
      zoom?: number;
      sort_order?: number;
      is_enabled?: boolean;
    };

    // Check if app exists
    const existing = await context.env.DB.prepare(
      `SELECT * FROM apps WHERE id = ?`
    ).bind(id).first<AppRow>();

    if (!existing) {
      return errorResponse('App not found', 404);
    }

    // Validate URL format if provided
    if (body.url) {
      try {
        new URL(body.url);
      } catch {
        return errorResponse('Invalid URL format', 400);
      }
    }

    // Validate color format if provided
    if (body.color && !/^#[0-9A-Fa-f]{6}$/.test(body.color)) {
      return errorResponse('Invalid color format. Use hex format like #6366f1', 400);
    }

    // Build update query
    const updates: string[] = [];
    const values: (string | number | null)[] = [];

    if (body.name !== undefined) {
      updates.push('name = ?');
      values.push(body.name);
    }

    if (body.icon !== undefined) {
      updates.push('icon = ?');
      values.push(body.icon);
    }

    if (body.color !== undefined) {
      updates.push('color = ?');
      values.push(body.color);
    }

    if (body.url !== undefined) {
      updates.push('url = ?');
      values.push(body.url);
    }

    if (body.zoom !== undefined) {
      updates.push('zoom = ?');
      values.push(Math.min(200, Math.max(10, body.zoom)));
    }

    if (body.sort_order !== undefined) {
      updates.push('sort_order = ?');
      values.push(body.sort_order);
    }

    if (body.is_enabled !== undefined) {
      updates.push('is_enabled = ?');
      values.push(body.is_enabled ? 1 : 0);
    }

    if (updates.length === 0) {
      return errorResponse('No fields to update', 400);
    }

    updates.push("updated_at = datetime('now')");
    values.push(id);

    await context.env.DB.prepare(
      `UPDATE apps SET ${updates.join(', ')} WHERE id = ?`
    ).bind(...values).run();

    // Fetch updated app
    const updated = await context.env.DB.prepare(
      `SELECT * FROM apps WHERE id = ?`
    ).bind(id).first<AppRow>();

    return jsonResponse({
      success: true,
      data: updated
    });
  } catch (error) {
    console.error('Update app error:', error);
    return errorResponse('Failed to update app');
  }
}

// DELETE - Remove app
export async function onRequestDelete(context: { request: Request; env: Env }) {
  const corsResponse = handleCors(context.request);
  if (corsResponse) return corsResponse;

  // Require superadmin privilege
  const authResult = await requireSuperadminPrivilege(context.request, context.env.DB);
  if (authResult instanceof Response) return authResult;

  try {
    const url = new URL(context.request.url);
    const id = url.searchParams.get('id');

    if (!id) {
      return errorResponse('App ID required', 400);
    }

    // Check if app exists
    const existing = await context.env.DB.prepare(
      `SELECT * FROM apps WHERE id = ?`
    ).bind(id).first<AppRow>();

    if (!existing) {
      return errorResponse('App not found', 404);
    }

    await context.env.DB.prepare(
      `DELETE FROM apps WHERE id = ?`
    ).bind(id).run();

    return jsonResponse({
      success: true,
      message: 'App deleted'
    });
  } catch (error) {
    console.error('Delete app error:', error);
    return errorResponse('Failed to delete app');
  }
}

export async function onRequestOptions(context: { request: Request }) {
  return handleCors(context.request);
}
