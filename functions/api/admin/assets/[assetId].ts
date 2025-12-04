import { jsonResponse, errorResponse, handleCors, requireAdmin, Env } from '../../../_lib/utils';

interface AssetUpdate {
  symbol?: string;
  name?: string;
  icon?: string;
  chain?: string;
  chainType?: string;
  contractAddress?: string;
  decimals?: number;
  isNative?: boolean;
  isEnabled?: boolean;
  sortOrder?: number;
}

// Update asset
export async function onRequestPut(context: { request: Request; env: Env; params: { assetId: string } }) {
  const corsResponse = handleCors(context.request);
  if (corsResponse) return corsResponse;

  try {
    const authResult = await requireAdmin(context.request, context.env.DB);
    if (authResult instanceof Response) return authResult;

    const { assetId } = context.params;
    const body = await context.request.json() as AssetUpdate;

    // Build dynamic update query
    const updates: string[] = [];
    const values: any[] = [];

    if (body.symbol !== undefined) {
      updates.push('symbol = ?');
      values.push(body.symbol.toUpperCase());
    }
    if (body.name !== undefined) {
      updates.push('name = ?');
      values.push(body.name);
    }
    if (body.icon !== undefined) {
      updates.push('icon = ?');
      values.push(body.icon);
    }
    if (body.chain !== undefined) {
      updates.push('chain = ?');
      values.push(body.chain);
    }
    if (body.chainType !== undefined) {
      updates.push('chain_type = ?');
      values.push(body.chainType);
    }
    if (body.contractAddress !== undefined) {
      updates.push('contract_address = ?');
      values.push(body.contractAddress);
    }
    if (body.decimals !== undefined) {
      updates.push('decimals = ?');
      values.push(body.decimals);
    }
    if (body.isNative !== undefined) {
      updates.push('is_native = ?');
      values.push(body.isNative ? 1 : 0);
    }
    if (body.isEnabled !== undefined) {
      updates.push('is_enabled = ?');
      values.push(body.isEnabled ? 1 : 0);
    }
    if (body.sortOrder !== undefined) {
      updates.push('sort_order = ?');
      values.push(body.sortOrder);
    }

    if (updates.length === 0) {
      return errorResponse('No fields to update', 400);
    }

    values.push(assetId);

    const result = await context.env.DB.prepare(
      `UPDATE assets SET ${updates.join(', ')} WHERE id = ?`
    ).bind(...values).run();

    if (result.meta.changes === 0) {
      return errorResponse('Asset not found', 404);
    }

    return jsonResponse({
      success: true,
      data: { assetId }
    });
  } catch (error) {
    console.error('Error updating asset:', error);
    return errorResponse('Failed to update asset');
  }
}

// Delete asset
export async function onRequestDelete(context: { request: Request; env: Env; params: { assetId: string } }) {
  const corsResponse = handleCors(context.request);
  if (corsResponse) return corsResponse;

  try {
    const authResult = await requireAdmin(context.request, context.env.DB);
    if (authResult instanceof Response) return authResult;

    const { assetId } = context.params;

    const result = await context.env.DB.prepare(
      'DELETE FROM assets WHERE id = ?'
    ).bind(assetId).run();

    if (result.meta.changes === 0) {
      return errorResponse('Asset not found', 404);
    }

    return jsonResponse({
      success: true,
      data: { assetId }
    });
  } catch (error) {
    console.error('Error deleting asset:', error);
    return errorResponse('Failed to delete asset');
  }
}

export async function onRequestOptions(context: { request: Request }) {
  return handleCors(context.request);
}
