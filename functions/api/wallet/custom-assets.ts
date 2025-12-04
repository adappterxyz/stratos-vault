import { jsonResponse, errorResponse, handleCors, requireAuth, generateId, Env } from '../../_lib/utils';

interface CustomAsset {
  id: string;
  symbol: string;
  name: string;
  icon: string | null;
  chain: string;
  chainType: string;
  contractAddress: string | null;
  decimals: number;
}

// GET - List user's custom assets
export async function onRequestGet(context: { request: Request; env: Env }) {
  const corsResponse = handleCors(context.request);
  if (corsResponse) return corsResponse;

  try {
    const authResult = await requireAuth(context.request, context.env.DB);
    if (authResult instanceof Response) return authResult;
    const { user } = authResult;

    const result = await context.env.DB.prepare(
      `SELECT id, symbol, name, icon, chain, chain_type, contract_address, decimals
       FROM user_custom_assets
       WHERE user_id = ?
       ORDER BY created_at DESC`
    ).bind(user.id).all();

    const assets: CustomAsset[] = (result.results || []).map((row: any) => ({
      id: row.id,
      symbol: row.symbol,
      name: row.name,
      icon: row.icon,
      chain: row.chain,
      chainType: row.chain_type,
      contractAddress: row.contract_address,
      decimals: row.decimals
    }));

    return jsonResponse({
      success: true,
      data: assets
    });
  } catch (error) {
    console.error('Error fetching custom assets:', error);
    return errorResponse('Failed to fetch custom assets');
  }
}

// POST - Add a custom asset
export async function onRequestPost(context: { request: Request; env: Env }) {
  const corsResponse = handleCors(context.request);
  if (corsResponse) return corsResponse;

  try {
    const authResult = await requireAuth(context.request, context.env.DB);
    if (authResult instanceof Response) return authResult;
    const { user } = authResult;

    const body = await context.request.json() as {
      symbol: string;
      name: string;
      icon?: string;
      chain: string;
      chainType: string;
      contractAddress?: string;
      decimals?: number;
    };

    // Validate required fields
    if (!body.symbol || !body.name || !body.chain || !body.chainType || !body.contractAddress) {
      return errorResponse('symbol, name, chain, chainType, and contractAddress are required', 400);
    }

    // Validate chain type
    const validChainTypes = ['evm', 'base', 'svm', 'btc', 'tron', 'ton', 'canton'];
    if (!validChainTypes.includes(body.chainType)) {
      return errorResponse(`Invalid chainType. Must be one of: ${validChainTypes.join(', ')}`, 400);
    }

    // Check if asset already exists for this user
    const existing = await context.env.DB.prepare(
      'SELECT id FROM user_custom_assets WHERE user_id = ? AND symbol = ? AND chain_type = ?'
    ).bind(user.id, body.symbol.toUpperCase(), body.chainType).first();

    if (existing) {
      return errorResponse('Asset with this symbol and chain already exists', 400);
    }

    const id = generateId();
    await context.env.DB.prepare(
      `INSERT INTO user_custom_assets (id, user_id, symbol, name, icon, chain, chain_type, contract_address, decimals)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      id,
      user.id,
      body.symbol.toUpperCase(),
      body.name,
      body.icon || null,
      body.chain,
      body.chainType,
      body.contractAddress || null,
      body.decimals || 18
    ).run();

    return jsonResponse({
      success: true,
      data: {
        id,
        symbol: body.symbol.toUpperCase(),
        name: body.name,
        icon: body.icon || null,
        chain: body.chain,
        chainType: body.chainType,
        contractAddress: body.contractAddress || null,
        decimals: body.decimals || 18
      }
    });
  } catch (error) {
    console.error('Error adding custom asset:', error);
    return errorResponse('Failed to add custom asset');
  }
}

// DELETE - Remove a custom asset
export async function onRequestDelete(context: { request: Request; env: Env }) {
  const corsResponse = handleCors(context.request);
  if (corsResponse) return corsResponse;

  try {
    const authResult = await requireAuth(context.request, context.env.DB);
    if (authResult instanceof Response) return authResult;
    const { user } = authResult;

    const url = new URL(context.request.url);
    const assetId = url.searchParams.get('id');

    if (!assetId) {
      return errorResponse('Asset ID is required', 400);
    }

    // Verify the asset belongs to this user
    const asset = await context.env.DB.prepare(
      'SELECT id FROM user_custom_assets WHERE id = ? AND user_id = ?'
    ).bind(assetId, user.id).first();

    if (!asset) {
      return errorResponse('Asset not found', 404);
    }

    await context.env.DB.prepare(
      'DELETE FROM user_custom_assets WHERE id = ? AND user_id = ?'
    ).bind(assetId, user.id).run();

    return jsonResponse({
      success: true,
      data: { deleted: true }
    });
  } catch (error) {
    console.error('Error deleting custom asset:', error);
    return errorResponse('Failed to delete custom asset');
  }
}

export async function onRequestOptions(context: { request: Request }) {
  return handleCors(context.request);
}
