import { jsonResponse, errorResponse, handleCors, Env, requireSuperadmin, requireSuperadminPrivilege } from '../../_lib/utils';

interface RpcEndpoint {
  id: string;
  chain_type: string;
  chain_name: string;
  chain_id: string | null;
  network: string;
  name: string | null;
  rpc_url: string;
  priority: number;
  is_enabled: number;
  created_at: string;
  updated_at: string;
}

// GET - List all RPC endpoints
export async function onRequestGet(context: { request: Request; env: Env }) {
  const corsResponse = handleCors(context.request);
  if (corsResponse) return corsResponse;

  // Require superadmin auth
  const authResult = await requireSuperadmin(context.request, context.env.DB);
  if (authResult instanceof Response) return authResult;

  try {
    // Fetch all endpoints ordered by chain_type, chain_name, network, priority
    const result = await context.env.DB.prepare(
      `SELECT * FROM rpc_endpoints ORDER BY chain_type, chain_name, network, priority`
    ).all();

    return jsonResponse({
      success: true,
      data: result.results as unknown as RpcEndpoint[]
    });
  } catch (error) {
    console.error('Get RPC endpoints error:', error);
    return errorResponse('Failed to fetch RPC endpoints');
  }
}

// POST - Add new RPC endpoint
export async function onRequestPost(context: { request: Request; env: Env }) {
  const corsResponse = handleCors(context.request);
  if (corsResponse) return corsResponse;

  // Require superadmin privilege
  const authResult = await requireSuperadminPrivilege(context.request, context.env.DB);
  if (authResult instanceof Response) return authResult;

  try {
    const body = await context.request.json() as {
      chain_type: string;
      chain_name: string;
      chain_id?: string;
      network: string;
      name?: string;
      rpc_url: string;
      priority?: number;
      is_enabled?: boolean;
    };

    // Validate required fields
    if (!body.chain_type || !body.chain_name || !body.network || !body.rpc_url) {
      return errorResponse('chain_type, chain_name, network, and rpc_url are required', 400);
    }

    // Validate network is mainnet or testnet
    if (!['mainnet', 'testnet'].includes(body.network)) {
      return errorResponse('network must be mainnet or testnet', 400);
    }

    // Validate chain_type
    const validChainTypes = ['evm', 'btc', 'svm', 'tron', 'ton'];
    if (!validChainTypes.includes(body.chain_type)) {
      return errorResponse(`Invalid chain_type. Must be one of: ${validChainTypes.join(', ')}`, 400);
    }

    // Validate URL format
    try {
      new URL(body.rpc_url);
    } catch {
      return errorResponse('Invalid rpc_url format', 400);
    }

    const id = crypto.randomUUID();
    const priority = body.priority ?? 0;
    const isEnabled = body.is_enabled !== false ? 1 : 0;

    await context.env.DB.prepare(
      `INSERT INTO rpc_endpoints (id, chain_type, chain_name, chain_id, network, name, rpc_url, priority, is_enabled)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(id, body.chain_type, body.chain_name, body.chain_id || null, body.network, body.name || null, body.rpc_url, priority, isEnabled).run();

    // Fetch the created endpoint
    const created = await context.env.DB.prepare(
      `SELECT * FROM rpc_endpoints WHERE id = ?`
    ).bind(id).first<RpcEndpoint>();

    return jsonResponse({
      success: true,
      data: created
    });
  } catch (error: any) {
    console.error('Create RPC endpoint error:', error);
    if (error.message?.includes('UNIQUE constraint failed')) {
      return errorResponse('An endpoint with this chain_type, network, and priority already exists', 400);
    }
    return errorResponse('Failed to create RPC endpoint');
  }
}

// PUT - Update RPC endpoint
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
      return errorResponse('Endpoint ID required', 400);
    }

    const body = await context.request.json() as {
      chain_type?: string;
      chain_name?: string;
      chain_id?: string | null;
      network?: string;
      name?: string;
      rpc_url?: string;
      priority?: number;
      is_enabled?: boolean;
    };

    // Check if endpoint exists
    const existing = await context.env.DB.prepare(
      `SELECT * FROM rpc_endpoints WHERE id = ?`
    ).bind(id).first<RpcEndpoint>();

    if (!existing) {
      return errorResponse('RPC endpoint not found', 404);
    }

    // Build update query
    const updates: string[] = [];
    const values: (string | number)[] = [];

    if (body.chain_type !== undefined) {
      const validChainTypes = ['evm', 'btc', 'svm', 'tron', 'ton'];
      if (!validChainTypes.includes(body.chain_type)) {
        return errorResponse(`Invalid chain_type. Must be one of: ${validChainTypes.join(', ')}`, 400);
      }
      updates.push('chain_type = ?');
      values.push(body.chain_type);
    }

    if (body.chain_name !== undefined) {
      updates.push('chain_name = ?');
      values.push(body.chain_name);
    }

    if (body.chain_id !== undefined) {
      updates.push('chain_id = ?');
      values.push(body.chain_id || '');
    }

    if (body.network !== undefined) {
      if (!['mainnet', 'testnet'].includes(body.network)) {
        return errorResponse('network must be mainnet or testnet', 400);
      }
      updates.push('network = ?');
      values.push(body.network);
    }

    if (body.name !== undefined) {
      updates.push('name = ?');
      values.push(body.name);
    }

    if (body.rpc_url !== undefined) {
      try {
        new URL(body.rpc_url);
      } catch {
        return errorResponse('Invalid rpc_url format', 400);
      }
      updates.push('rpc_url = ?');
      values.push(body.rpc_url);
    }

    if (body.priority !== undefined) {
      updates.push('priority = ?');
      values.push(body.priority);
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
      `UPDATE rpc_endpoints SET ${updates.join(', ')} WHERE id = ?`
    ).bind(...values).run();

    // Fetch updated endpoint
    const updated = await context.env.DB.prepare(
      `SELECT * FROM rpc_endpoints WHERE id = ?`
    ).bind(id).first<RpcEndpoint>();

    return jsonResponse({
      success: true,
      data: updated
    });
  } catch (error: any) {
    console.error('Update RPC endpoint error:', error);
    if (error.message?.includes('UNIQUE constraint failed')) {
      return errorResponse('An endpoint with this chain_type, network, and priority already exists', 400);
    }
    return errorResponse('Failed to update RPC endpoint');
  }
}

// DELETE - Remove RPC endpoint
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
      return errorResponse('Endpoint ID required', 400);
    }

    // Check if endpoint exists
    const existing = await context.env.DB.prepare(
      `SELECT * FROM rpc_endpoints WHERE id = ?`
    ).bind(id).first<RpcEndpoint>();

    if (!existing) {
      return errorResponse('RPC endpoint not found', 404);
    }

    await context.env.DB.prepare(
      `DELETE FROM rpc_endpoints WHERE id = ?`
    ).bind(id).run();

    return jsonResponse({
      success: true,
      message: 'RPC endpoint deleted'
    });
  } catch (error) {
    console.error('Delete RPC endpoint error:', error);
    return errorResponse('Failed to delete RPC endpoint');
  }
}

export async function onRequestOptions(context: { request: Request }) {
  return handleCors(context.request);
}
