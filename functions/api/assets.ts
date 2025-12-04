import { jsonResponse, errorResponse, handleCors, Env } from '../_lib/utils';

interface AssetChain {
  chain: string;
  chainType: string;
  contractAddress: string | null;
  decimals: number;
}

interface Asset {
  symbol: string;
  name: string;
  icon: string | null;
  chain: string;
  chainType: string;
  contractAddress: string | null;
  decimals: number;
  isNative: boolean;
  chains: AssetChain[];  // All chains this asset is available on
}

// Public endpoint - returns enabled assets with multi-chain support
export async function onRequestGet(context: { request: Request; env: Env }) {
  const corsResponse = handleCors(context.request);
  if (corsResponse) return corsResponse;

  try {
    // Get base assets
    const assetsResult = await context.env.DB.prepare(
      `SELECT id, symbol, name, icon, chain, chain_type, contract_address, decimals, is_native, sort_order
       FROM assets
       WHERE is_enabled = 1
       ORDER BY sort_order ASC, symbol ASC`
    ).all();

    // Get all asset chain mappings
    const chainsResult = await context.env.DB.prepare(
      `SELECT ac.asset_id, ac.chain, ac.chain_type, ac.contract_address, ac.decimals
       FROM asset_chains ac
       JOIN assets a ON ac.asset_id = a.id
       WHERE ac.is_enabled = 1 AND a.is_enabled = 1
       ORDER BY ac.chain`
    ).all();

    // Group chains by asset_id
    const chainsByAsset: Record<string, AssetChain[]> = {};
    for (const row of (chainsResult.results || []) as any[]) {
      if (!chainsByAsset[row.asset_id]) {
        chainsByAsset[row.asset_id] = [];
      }
      chainsByAsset[row.asset_id].push({
        chain: row.chain,
        chainType: row.chain_type,
        contractAddress: row.contract_address,
        decimals: row.decimals
      });
    }

    const assets: Asset[] = (assetsResult.results || []).map((row: any) => ({
      symbol: row.symbol,
      name: row.name,
      icon: row.icon,
      chain: row.chain,
      chainType: row.chain_type,
      contractAddress: row.contract_address,
      decimals: row.decimals,
      isNative: row.is_native === 1,
      chains: chainsByAsset[row.id] || [{
        chain: row.chain,
        chainType: row.chain_type,
        contractAddress: row.contract_address,
        decimals: row.decimals
      }]
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

export async function onRequestOptions(context: { request: Request }) {
  return handleCors(context.request);
}
