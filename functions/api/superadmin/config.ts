import { jsonResponse, errorResponse, handleCors, Env, requireSuperadmin, requireSuperadminPrivilege } from '../../_lib/utils';

// Allowed configuration keys that can be overridden
// Note: RPC_ENDPOINTS is now managed via dedicated rpc_endpoints table
// Note: DOCK_APPS and ALLOWED_IFRAME_ORIGINS are now managed via dedicated apps table
const ALLOWED_CONFIG_KEYS = [
  'RP_NAME',
  'THEME',
  'ORG_NAME',
  'CHAT_AGENT_WEBHOOK_URL',
  'SPLICE_HOST',
  'CANTON_JSON_HOST'
];

interface ConfigOverride {
  key: string;
  value: string;
  updated_at: string;
  updated_by: string | null;
}

// GET - Get all configuration (wrangler.toml + overrides)
export async function onRequestGet(context: { request: Request; env: Env }) {
  const corsResponse = handleCors(context.request);
  if (corsResponse) return corsResponse;

  // Require superadmin auth
  const authResult = await requireSuperadmin(context.request, context.env.DB);
  if (authResult instanceof Response) return authResult;

  try {
    // Get all overrides from database
    const overridesResult = await context.env.DB.prepare(
      `SELECT key, value, updated_at, updated_by FROM config_overrides`
    ).all();

    const overrides = (overridesResult.results as unknown as ConfigOverride[]).reduce((acc, row) => {
      acc[row.key] = row.value;
      return acc;
    }, {} as Record<string, string>);

    // Build configuration with overrides taking precedence
    const config = {
      RP_NAME: overrides.RP_NAME || context.env.RP_NAME || 'Canton Wallet',
      THEME: overrides.THEME || context.env.THEME || 'purple',
      ORG_NAME: overrides.ORG_NAME || context.env.ORG_NAME || 'Organization1',
      CHAT_AGENT_WEBHOOK_URL: overrides.CHAT_AGENT_WEBHOOK_URL || context.env.CHAT_AGENT_WEBHOOK_URL || '',
      SPLICE_HOST: overrides.SPLICE_HOST || context.env.SPLICE_HOST || '',
      CANTON_JSON_HOST: overrides.CANTON_JSON_HOST || context.env.CANTON_JSON_HOST || ''
    };

    // Also return which values are overridden
    const overriddenKeys = Object.keys(overrides);

    // Fetch Canton version from JSON API
    let cantonVersion: string | null = null;
    try {
      const jsonHost = context.env.CANTON_JSON_HOST || context.env.SPLICE_HOST || 'localhost';
      const jsonPort = parseInt(context.env.CANTON_JSON_PORT || '443');
      const protocol = jsonPort === 443 ? 'https' : 'http';
      const portSuffix = jsonPort === 443 ? '' : `:${jsonPort}`;
      const versionRes = await fetch(`${protocol}://${jsonHost}${portSuffix}/v2/version`);
      if (versionRes.ok) {
        const versionData = await versionRes.json() as { version?: string };
        cantonVersion = versionData.version || null;
      }
    } catch {
      // Version fetch failed, continue without it
    }

    // Gather bound services info (read-only reference)
    const boundServices: Record<string, string> = {};

    // D1 Database
    if (context.env.DB) {
      boundServices['D1 Database'] = 'canton-wallet-auth';
    }

    // Environment vars (non-secret references)
    if (context.env.SPLICE_PORT) boundServices['Splice Port'] = context.env.SPLICE_PORT;
    if (context.env.CANTON_JSON_PORT) boundServices['Canton JSON Port'] = context.env.CANTON_JSON_PORT;
    if (context.env.CANTON_AUTH_USER) boundServices['Canton Auth User'] = context.env.CANTON_AUTH_USER;
    if (context.env.SPLICE_ADMIN_USER) boundServices['Splice Admin User'] = context.env.SPLICE_ADMIN_USER;
    if (context.env.CANTON_AUTH_AUDIENCE) boundServices['Canton Auth Audience'] = context.env.CANTON_AUTH_AUDIENCE;
    if (context.env.RP_ID) boundServices['RP ID'] = context.env.RP_ID;
    if (context.env.CANTON_AUTH_SECRET) boundServices['Canton Auth Secret'] = '••••••••';

    return jsonResponse({
      success: true,
      data: {
        config,
        overriddenKeys,
        allowedKeys: ALLOWED_CONFIG_KEYS,
        cantonVersion,
        boundServices
      }
    });
  } catch (error) {
    console.error('Get config error:', error);
    return errorResponse('Failed to fetch configuration');
  }
}

// PUT - Update configuration overrides
export async function onRequestPut(context: { request: Request; env: Env }) {
  const corsResponse = handleCors(context.request);
  if (corsResponse) return corsResponse;

  // Require superadmin privilege to modify config
  const authResult = await requireSuperadminPrivilege(context.request, context.env.DB);
  if (authResult instanceof Response) return authResult;

  try {
    const body = await context.request.json() as Record<string, string | null>;

    const updates: { key: string; value: string }[] = [];
    const deletes: string[] = [];

    for (const [key, value] of Object.entries(body)) {
      if (!ALLOWED_CONFIG_KEYS.includes(key)) {
        return errorResponse(`Invalid configuration key: ${key}`, 400);
      }

      if (value === null || value === '') {
        // Remove override (revert to wrangler.toml value)
        deletes.push(key);
      } else {
        // Validate specific fields
        if (key === 'THEME' && !['purple', 'teal', 'blue', 'green', 'orange', 'rose', 'slate', 'light'].includes(value)) {
          return errorResponse('Invalid theme value', 400);
        }
        updates.push({ key, value });
      }
    }

    // Delete overrides
    for (const key of deletes) {
      await context.env.DB.prepare(
        `DELETE FROM config_overrides WHERE key = ?`
      ).bind(key).run();
    }

    // Upsert overrides
    for (const { key, value } of updates) {
      await context.env.DB.prepare(
        `INSERT INTO config_overrides (key, value, updated_at, updated_by)
         VALUES (?, ?, datetime('now'), ?)
         ON CONFLICT(key) DO UPDATE SET
           value = excluded.value,
           updated_at = datetime('now'),
           updated_by = excluded.updated_by`
      ).bind(key, value, authResult.user.id).run();
    }

    // Return updated config
    const overridesResult = await context.env.DB.prepare(
      `SELECT key, value FROM config_overrides`
    ).all();

    const overrides = (overridesResult.results as unknown as ConfigOverride[]).reduce((acc, row) => {
      acc[row.key] = row.value;
      return acc;
    }, {} as Record<string, string>);

    const config = {
      RP_NAME: overrides.RP_NAME || context.env.RP_NAME || 'Canton Wallet',
      THEME: overrides.THEME || context.env.THEME || 'purple',
      ORG_NAME: overrides.ORG_NAME || context.env.ORG_NAME || 'Organization1',
      CHAT_AGENT_WEBHOOK_URL: overrides.CHAT_AGENT_WEBHOOK_URL || context.env.CHAT_AGENT_WEBHOOK_URL || '',
      SPLICE_HOST: overrides.SPLICE_HOST || context.env.SPLICE_HOST || '',
      CANTON_JSON_HOST: overrides.CANTON_JSON_HOST || context.env.CANTON_JSON_HOST || ''
    };

    return jsonResponse({
      success: true,
      data: {
        config,
        overriddenKeys: Object.keys(overrides)
      }
    });
  } catch (error) {
    console.error('Update config error:', error);
    return errorResponse('Failed to update configuration');
  }
}

// DELETE - Reset a specific config to wrangler.toml default
export async function onRequestDelete(context: { request: Request; env: Env }) {
  const corsResponse = handleCors(context.request);
  if (corsResponse) return corsResponse;

  // Require superadmin privilege
  const authResult = await requireSuperadminPrivilege(context.request, context.env.DB);
  if (authResult instanceof Response) return authResult;

  try {
    const url = new URL(context.request.url);
    const key = url.searchParams.get('key');

    if (!key) {
      return errorResponse('Config key required', 400);
    }

    if (!ALLOWED_CONFIG_KEYS.includes(key)) {
      return errorResponse(`Invalid configuration key: ${key}`, 400);
    }

    await context.env.DB.prepare(
      `DELETE FROM config_overrides WHERE key = ?`
    ).bind(key).run();

    return jsonResponse({
      success: true,
      message: `Configuration "${key}" reset to default`
    });
  } catch (error) {
    console.error('Delete config error:', error);
    return errorResponse('Failed to reset configuration');
  }
}

export async function onRequestOptions(context: { request: Request }) {
  return handleCors(context.request);
}
