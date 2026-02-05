import { jsonResponse, errorResponse, handleCors, requireAuth, Env } from '../../_lib/utils';

interface TransactionRow {
  id: string;
  user_id: string;
  tx_hash: string | null;
  tx_type: string;
  status: string;
  asset_symbol: string;
  chain: string;
  chain_type: string;
  amount: string;
  amount_usd: string | null;
  fee: string | null;
  fee_asset: string | null;
  from_address: string | null;
  to_address: string | null;
  description: string | null;
  metadata: string | null;
  block_number: number | null;
  block_timestamp: string | null;
  created_at: string;
  updated_at: string;
}

// GET - List transactions with pagination and filters
export async function onRequestGet(context: { request: Request; env: Env }) {
  const corsResponse = handleCors(context.request);
  if (corsResponse) return corsResponse;

  try {
    const authResult = await requireAuth(context.request, context.env.DB);
    if (authResult instanceof Response) return authResult;
    const { user } = authResult;

    const url = new URL(context.request.url);
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '10'), 100);
    const offset = parseInt(url.searchParams.get('offset') || '0');
    const chainType = url.searchParams.get('chain_type'); // Optional filter
    const chain = url.searchParams.get('chain'); // Optional filter
    const status = url.searchParams.get('status'); // Optional filter

    // Build query with filters
    let query = `SELECT * FROM transactions WHERE user_id = ?`;
    const params: (string | number)[] = [user.id];

    if (chainType) {
      query += ` AND chain_type = ?`;
      params.push(chainType);
    }

    if (chain) {
      query += ` AND chain = ?`;
      params.push(chain);
    }

    if (status) {
      query += ` AND status = ?`;
      params.push(status);
    }

    // Get total count for pagination
    const countQuery = query.replace('SELECT *', 'SELECT COUNT(*) as total');
    const countResult = await context.env.DB.prepare(countQuery).bind(...params).first<{ total: number }>();
    const total = countResult?.total || 0;

    // Add ordering and pagination (sort by block_timestamp, fallback to created_at)
    query += ` ORDER BY COALESCE(block_timestamp, created_at) DESC LIMIT ? OFFSET ?`;
    params.push(limit, offset);

    const result = await context.env.DB.prepare(query).bind(...params).all();
    const transactions = (result.results || []) as unknown as TransactionRow[];

    // Transform for frontend
    const data = transactions.map(tx => ({
      id: tx.id,
      txHash: tx.tx_hash,
      type: tx.tx_type,
      status: tx.status,
      asset: tx.asset_symbol,
      chain: tx.chain,
      chainType: tx.chain_type,
      amount: tx.amount,
      amountUsd: tx.amount_usd,
      fee: tx.fee,
      feeAsset: tx.fee_asset,
      from: tx.from_address,
      to: tx.to_address,
      description: tx.description,
      metadata: tx.metadata ? JSON.parse(tx.metadata) : null,
      blockNumber: tx.block_number,
      blockTimestamp: tx.block_timestamp,
      createdAt: tx.created_at
    }));

    return jsonResponse({
      success: true,
      data,
      pagination: {
        total,
        limit,
        offset,
        hasMore: offset + limit < total
      }
    });
  } catch (error) {
    console.error('Error getting transactions:', error);
    return errorResponse('Failed to fetch transactions');
  }
}

// POST - Record a new transaction
export async function onRequestPost(context: { request: Request; env: Env }) {
  const corsResponse = handleCors(context.request);
  if (corsResponse) return corsResponse;

  try {
    const authResult = await requireAuth(context.request, context.env.DB);
    if (authResult instanceof Response) return authResult;
    const { user } = authResult;

    const body = await context.request.json() as {
      txHash?: string;
      txType: string;
      status?: string;
      assetSymbol: string;
      chain: string;
      chainType: string;
      amount: string;
      amountUsd?: string;
      fee?: string;
      feeAsset?: string;
      fromAddress?: string;
      toAddress?: string;
      description?: string;
      metadata?: Record<string, any>;
      blockNumber?: number;
      blockTimestamp?: string;
    };

    // Validate required fields
    if (!body.txType || !body.assetSymbol || !body.chain || !body.chainType || !body.amount) {
      return errorResponse('Missing required fields: txType, assetSymbol, chain, chainType, amount', 400);
    }

    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    await context.env.DB.prepare(
      `INSERT INTO transactions (
        id, user_id, tx_hash, tx_type, status, asset_symbol, chain, chain_type,
        amount, amount_usd, fee, fee_asset, from_address, to_address,
        description, metadata, block_number, block_timestamp, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      id,
      user.id,
      body.txHash || null,
      body.txType,
      body.status || 'confirmed',
      body.assetSymbol,
      body.chain,
      body.chainType,
      body.amount,
      body.amountUsd || null,
      body.fee || null,
      body.feeAsset || null,
      body.fromAddress || null,
      body.toAddress || null,
      body.description || null,
      body.metadata ? JSON.stringify(body.metadata) : null,
      body.blockNumber || null,
      body.blockTimestamp || null,
      now,
      now
    ).run();

    return jsonResponse({
      success: true,
      data: { id }
    });
  } catch (error) {
    console.error('Error recording transaction:', error);
    return errorResponse('Failed to record transaction');
  }
}

export async function onRequestOptions(context: { request: Request }) {
  return handleCors(context.request);
}
