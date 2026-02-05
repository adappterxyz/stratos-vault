import { jsonResponse, handleCors, Env, requireSuperadmin } from '../../../_lib/utils';

interface AssetChain {
  chain: string;
  chain_type: string;
  chain_id: string | null;
  network: string;
}

// Default supported chains - used as fallback if asset_chains is empty
const DEFAULT_CHAINS: AssetChain[] = [
  { chain: 'Ethereum', chain_type: 'evm', chain_id: '1', network: 'mainnet' },
  { chain: 'Sepolia', chain_type: 'evm', chain_id: '11155111', network: 'mainnet' },
  { chain: 'Base', chain_type: 'evm', chain_id: '8453', network: 'mainnet' },
  { chain: 'Base Sepolia', chain_type: 'evm', chain_id: '84532', network: 'mainnet' },
  { chain: 'Bitcoin', chain_type: 'btc', chain_id: null, network: 'mainnet' },
  { chain: 'Solana', chain_type: 'svm', chain_id: null, network: 'mainnet' },
  { chain: 'Tron', chain_type: 'tron', chain_id: null, network: 'mainnet' },
  { chain: 'TON', chain_type: 'ton', chain_id: null, network: 'mainnet' }
];

// Map of known EVM chain IDs
const CHAIN_IDS: Record<string, string> = {
  'Ethereum': '1',
  'Base': '8453',
  'Sepolia': '11155111',
  'Base Sepolia': '84532'
};

// GET - List all unique chains from asset_chains table
export async function onRequestGet(context: { request: Request; env: Env }) {
  const corsResponse = handleCors(context.request);
  if (corsResponse) return corsResponse;

  // Require superadmin auth
  const authResult = await requireSuperadmin(context.request, context.env.DB);
  if (authResult instanceof Response) return authResult;

  try {
    // Fetch distinct chains with their chain_type
    const result = await context.env.DB.prepare(
      `SELECT DISTINCT chain, chain_type
       FROM asset_chains
       WHERE is_enabled = 1
       ORDER BY chain_type, chain`
    ).all();

    // If no chains in database, return default list
    if (!result.results || result.results.length === 0) {
      return jsonResponse({
        success: true,
        data: DEFAULT_CHAINS
      });
    }

    // Enhance with chain_id for EVM chains
    const chains: AssetChain[] = (result.results as Array<{ chain: string; chain_type: string }>).map(row => ({
      chain: row.chain,
      chain_type: row.chain_type,
      chain_id: row.chain_type === 'evm' ? (CHAIN_IDS[row.chain] || null) : null,
      network: 'mainnet' // Default to mainnet, user will select network when adding RPC
    }));

    return jsonResponse({
      success: true,
      data: chains
    });
  } catch (error) {
    console.error('Get chains error:', error);
    // Return default chains on error
    return jsonResponse({
      success: true,
      data: DEFAULT_CHAINS
    });
  }
}

export async function onRequestOptions(context: { request: Request }) {
  return handleCors(context.request);
}
