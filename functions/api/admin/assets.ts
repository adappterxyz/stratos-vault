import { jsonResponse, errorResponse, handleCors, requireAdmin, generateId, Env } from '../../_lib/utils';

interface AssetInput {
  symbol: string;
  name: string;
  icon?: string;
  chain: string;
  chainType?: string;
  contractAddress?: string;
  decimals?: number;
  isNative?: boolean;
  isEnabled?: boolean;
  sortOrder?: number;
}

// Get all assets (including disabled)
export async function onRequestGet(context: { request: Request; env: Env }) {
  const corsResponse = handleCors(context.request);
  if (corsResponse) return corsResponse;

  try {
    const authResult = await requireAdmin(context.request, context.env.DB);
    if (authResult instanceof Response) return authResult;

    const result = await context.env.DB.prepare(
      `SELECT * FROM assets ORDER BY sort_order ASC, symbol ASC`
    ).all();

    const assets = (result.results || []).map((row: any) => ({
      id: row.id,
      symbol: row.symbol,
      name: row.name,
      icon: row.icon,
      chain: row.chain,
      chainType: row.chain_type,
      contractAddress: row.contract_address,
      decimals: row.decimals,
      isNative: row.is_native === 1,
      isEnabled: row.is_enabled === 1,
      sortOrder: row.sort_order,
      createdAt: row.created_at
    }));

    return jsonResponse({
      success: true,
      data: assets
    });
  } catch (error) {
    console.error('Error fetching assets:', error);
    return errorResponse('Failed to fetch assets');
  }
}

// Add new asset
export async function onRequestPost(context: { request: Request; env: Env }) {
  const corsResponse = handleCors(context.request);
  if (corsResponse) return corsResponse;

  try {
    const authResult = await requireAdmin(context.request, context.env.DB);
    if (authResult instanceof Response) return authResult;

    const body = await context.request.json() as AssetInput;

    if (!body.symbol || !body.name || !body.chain) {
      return errorResponse('symbol, name, and chain are required', 400);
    }

    const id = generateId();
    await context.env.DB.prepare(
      `INSERT INTO assets (id, symbol, name, icon, chain, chain_type, contract_address, decimals, is_native, is_enabled, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      id,
      body.symbol.toUpperCase(),
      body.name,
      body.icon || null,
      body.chain,
      body.chainType || null,
      body.contractAddress || null,
      body.decimals || 18,
      body.isNative ? 1 : 0,
      body.isEnabled !== false ? 1 : 0,
      body.sortOrder || 0
    ).run();

    return jsonResponse({
      success: true,
      data: { id, symbol: body.symbol.toUpperCase() }
    });
  } catch (error: any) {
    console.error('Error adding asset:', error);
    if (error.message?.includes('UNIQUE constraint failed')) {
      return errorResponse('Asset with this symbol already exists', 400);
    }
    return errorResponse('Failed to add asset');
  }
}

export async function onRequestOptions(context: { request: Request }) {
  return handleCors(context.request);
}
