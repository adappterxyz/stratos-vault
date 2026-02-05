import { jsonResponse, handleCors, Env, validateSession } from '../_lib/utils';

interface DockApp {
  id: string;
  name: string;
  icon: string;
  color: string;
  url: string | null;
}

interface ConfigOverride {
  key: string;
  value: string;
}

interface RpcEndpoint {
  chain_type: string;
  chain_name: string;
  chain_id: string | null;
  network: string;
  rpc_url: string;
  priority: number;
}

interface AppRow {
  id: string;
  name: string;
  icon: string;
  color: string;
  url: string | null;
  sort_order: number;
  is_enabled: number;
}

// Build RPC endpoints object from database records
// Returns format expected by signers:
// - EVM: keyed by chain_id (e.g., { "1": "url", "8453": "url" })
// - Others: keyed by network (e.g., { "mainnet": "url", "testnet": "url" })
function buildRpcEndpoints(endpoints: RpcEndpoint[]): Record<string, Record<string, string>> {
  const result: Record<string, Record<string, string>> = {};

  for (const ep of endpoints) {
    if (!result[ep.chain_type]) {
      result[ep.chain_type] = {};
    }

    // For EVM chains, key by chain_id; for others, key by network
    let key: string;
    if (ep.chain_type === 'evm' && ep.chain_id) {
      key = ep.chain_id;
    } else {
      key = ep.network;
    }

    // Only take the first (lowest priority) endpoint for each key
    if (!result[ep.chain_type][key]) {
      result[ep.chain_type][key] = ep.rpc_url;
    }
  }

  return result;
}

// Public config endpoint - no auth required
// Returns theme, org name, dock apps, allowed iframe origins, and RPC endpoints
export async function onRequestGet(context: { request: Request; env: Env }) {
  const corsResponse = handleCors(context.request);
  if (corsResponse) return corsResponse;

  // Fetch configuration overrides from database
  let overrides: Record<string, string> = {};
  try {
    const result = await context.env.DB.prepare(
      `SELECT key, value FROM config_overrides`
    ).all();
    overrides = (result.results as unknown as ConfigOverride[]).reduce((acc, row) => {
      acc[row.key] = row.value;
      return acc;
    }, {} as Record<string, string>);
  } catch (e) {
    // Table might not exist yet, use defaults
    console.error('Failed to fetch config overrides:', e);
  }

  // Fetch RPC endpoints from dedicated table
  let rpcEndpoints: Record<string, Record<string, string>> = {};
  try {
    const rpcResult = await context.env.DB.prepare(
      `SELECT chain_type, chain_name, chain_id, network, rpc_url, priority
       FROM rpc_endpoints
       WHERE is_enabled = 1
       ORDER BY chain_type, chain_name, network, priority`
    ).all();

    if (rpcResult.results && rpcResult.results.length > 0) {
      rpcEndpoints = buildRpcEndpoints(rpcResult.results as unknown as RpcEndpoint[]);
    }
  } catch (e) {
    // Table might not exist yet
    console.error('Failed to fetch RPC endpoints:', e);
  }

  // Check for optional user authentication
  const authHeader = context.request.headers.get('Authorization');
  const sessionId = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
  let userId: string | null = null;
  if (sessionId) {
    try {
      const user = await validateSession(context.env.DB, sessionId);
      if (user) userId = user.id;
    } catch (e) {
      // Ignore auth errors - treat as unauthenticated
    }
  }

  // Fetch apps from dedicated table
  let dockApps: DockApp[] = [];
  let allowedIframeOrigins: string[] = [];
  try {
    const appsResult = await context.env.DB.prepare(
      `SELECT id, name, icon, color, url, sort_order
       FROM apps
       WHERE is_enabled = 1
       ORDER BY sort_order, name`
    ).all();

    if (appsResult.results && appsResult.results.length > 0) {
      let apps = appsResult.results as unknown as AppRow[];

      // Filter apps by user access control
      // Apps with NO entries in user_app_access are open (available to everyone)
      // Apps WITH entries are restricted to those assigned users
      try {
        const accessResult = await context.env.DB.prepare(
          `SELECT DISTINCT app_id FROM user_app_access`
        ).all();
        const restrictedAppIds = new Set(
          (accessResult.results || []).map((r: any) => r.app_id as string)
        );

        if (restrictedAppIds.size > 0) {
          if (userId) {
            // Get this user's allowed apps
            const userAccessResult = await context.env.DB.prepare(
              `SELECT app_id FROM user_app_access WHERE user_id = ?`
            ).bind(userId).all();
            const userAllowedAppIds = new Set(
              (userAccessResult.results || []).map((r: any) => r.app_id as string)
            );

            // Keep open apps + apps this user has access to
            apps = apps.filter(app =>
              !restrictedAppIds.has(app.id) || userAllowedAppIds.has(app.id)
            );
          } else {
            // No auth - only show open apps (not restricted)
            apps = apps.filter(app => !restrictedAppIds.has(app.id));
          }
        }
      } catch (e) {
        // user_app_access table might not exist yet - show all apps
        console.error('Failed to check app access:', e);
      }

      dockApps = apps.map(app => ({
        id: app.id,
        name: app.name,
        icon: app.icon,
        color: app.color,
        url: app.url
      }));

      // Extract allowed iframe origins from app URLs
      allowedIframeOrigins = apps
        .filter(app => app.url)
        .map(app => {
          try {
            const url = new URL(app.url!);
            return url.origin;
          } catch {
            return null;
          }
        })
        .filter((origin): origin is string => origin !== null);

      // Remove duplicates
      allowedIframeOrigins = [...new Set(allowedIframeOrigins)];
    }
  } catch (e) {
    // Table might not exist yet, use empty array
    console.error('Failed to fetch apps:', e);
  }

  // Get effective values (override > env > default)
  const theme = overrides.THEME || context.env.THEME || 'purple';
  const orgName = overrides.ORG_NAME || context.env.ORG_NAME || 'Canton Wallet';

  return jsonResponse({
    success: true,
    data: {
      theme,
      orgName,
      dockApps,
      allowedIframeOrigins,
      rpcEndpoints,
      chatAgentWebhookUrl: overrides.CHAT_AGENT_WEBHOOK_URL || context.env.CHAT_AGENT_WEBHOOK_URL || null,
      logo: overrides.LOGO || null
    }
  });
}

export async function onRequestOptions(context: { request: Request }) {
  return handleCors(context.request);
}
