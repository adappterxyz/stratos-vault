/**
 * Transaction Sync API
 *
 * Fetches transaction history for tracked assets from configured RPC endpoints.
 * Only syncs transactions for assets defined in assets/asset_chains tables.
 */

import { jsonResponse, errorResponse, handleCors, requireAuth, recordTransaction, Env } from '../../_lib/utils';

interface WalletAddress {
  chain_type: string;
  address: string;
}

interface TrackedAsset {
  symbol: string;
  name: string;
  chain: string;
  chain_type: string;
  contract_address: string | null;
  decimals: number;
  is_native: number;
}

interface RpcEndpoint {
  chain_type: string;
  chain_name: string | null;
  rpc_url: string;
}

interface SyncResult {
  chain: string;
  asset: string;
  fetched: number;
  recorded: number;
  errors: string[];
}

interface NormalizedTransaction {
  txHash: string;
  type: 'send' | 'receive';
  status: 'pending' | 'confirmed' | 'failed';
  assetSymbol: string;
  chain: string;
  amount: string;
  from: string;
  to: string;
  description?: string;
  blockNumber?: number;
  blockTimestamp?: number;
  fee?: string;
  feeAsset?: string;
}

export async function onRequestPost(context: { request: Request; env: Env }) {
  const corsResponse = handleCors(context.request);
  if (corsResponse) return corsResponse;

  try {
    const authResult = await requireAuth(context.request, context.env.DB);
    if (authResult instanceof Response) return authResult;
    const { user } = authResult;

    // Get network mode from request body (default to mainnet)
    let network: 'mainnet' | 'testnet' = 'mainnet';
    try {
      const body = await context.request.json() as { network?: string };
      if (body.network === 'testnet') {
        network = 'testnet';
      }
    } catch {
      // No body or invalid JSON, use default
    }

    // Get user's wallet addresses
    const wallets = await context.env.DB.prepare(
      'SELECT chain_type, address FROM wallet_addresses WHERE user_id = ?'
    ).bind(user.id).all<WalletAddress>();

    if (!wallets.results || wallets.results.length === 0) {
      return jsonResponse({
        success: true,
        data: { message: 'No wallets found', results: [] }
      });
    }

    // Get tracked assets from asset_chains (each chain entry is tracked individually)
    const assetsResult = await context.env.DB.prepare(
      `SELECT a.symbol, a.name, ac.chain, ac.chain_type, ac.contract_address, ac.decimals, a.is_native
       FROM asset_chains ac
       JOIN assets a ON ac.asset_id = a.id
       WHERE a.is_enabled = 1 AND ac.is_enabled = 1`
    ).all<TrackedAsset>();

    const trackedAssets = assetsResult.results || [];

    // Get RPC endpoints from database
    const rpcResult = await context.env.DB.prepare(
      `SELECT chain_type, chain_name, rpc_url
       FROM rpc_endpoints
       WHERE network = ? AND is_enabled = 1
       ORDER BY priority ASC`
    ).bind(network).all<RpcEndpoint>();

    // Group RPC endpoints by chain_type and chain_name
    const rpcByChain: Record<string, string> = {};
    for (const rpc of rpcResult.results || []) {
      const key = rpc.chain_name ? `${rpc.chain_type}_${rpc.chain_name}` : rpc.chain_type;
      if (!rpcByChain[key]) {
        rpcByChain[key] = rpc.rpc_url;
      }
    }

    // Get existing transaction hashes to avoid duplicates
    // Get existing transactions - include asset_symbol to allow same tx_hash for different assets
    const existingTxs = await context.env.DB.prepare(
      'SELECT tx_hash, asset_symbol FROM transactions WHERE user_id = ? AND tx_hash IS NOT NULL'
    ).bind(user.id).all<{ tx_hash: string; asset_symbol: string }>();

    // Key by tx_hash + asset_symbol to allow same transaction for different assets
    const existingTxKeys = new Set(existingTxs.results?.map(t => `${t.tx_hash.toLowerCase()}_${t.asset_symbol}`) || []);

    const results: SyncResult[] = [];

    // Process each tracked asset
    for (const asset of trackedAssets) {
      const wallet = wallets.results.find(w => w.chain_type === asset.chain_type);
      if (!wallet) continue;

      const result: SyncResult = {
        chain: asset.chain,
        asset: asset.symbol,
        fetched: 0,
        recorded: 0,
        errors: []
      };

      try {
        const rpcKey = `${asset.chain_type}_${asset.chain}`;
        const rpcUrl = rpcByChain[rpcKey] || rpcByChain[asset.chain_type];

        if (!rpcUrl) {
          result.errors.push(`No RPC endpoint configured for ${asset.chain}`);
          results.push(result);
          continue;
        }

        const transactions = await fetchAssetTransactions(
          asset,
          wallet.address,
          rpcUrl
        );

        result.fetched = transactions.length;

        // Record new transactions
        for (const tx of transactions) {
          const txHash = tx.txHash?.toLowerCase();
          const txKey = txHash ? `${txHash}_${tx.assetSymbol}` : null;
          if (txKey && existingTxKeys.has(txKey)) {
            continue;
          }

          try {
            await recordTransaction(context.env.DB, {
              userId: user.id,
              txHash: tx.txHash,
              txType: tx.type,
              status: tx.status,
              assetSymbol: tx.assetSymbol,
              chain: tx.chain,
              chainType: asset.chain_type,
              amount: tx.amount,
              fromAddress: tx.from,
              toAddress: tx.to,
              description: tx.description,
              blockNumber: tx.blockNumber,
              blockTimestamp: tx.blockTimestamp ? new Date(tx.blockTimestamp * 1000).toISOString() : undefined,
              fee: tx.fee,
              feeAsset: tx.feeAsset
            });
            result.recorded++;
            if (txKey) existingTxKeys.add(txKey);
          } catch (recordErr) {
            result.errors.push(`Failed to record tx ${txHash}: ${recordErr}`);
          }
        }
      } catch (fetchErr) {
        result.errors.push(`Fetch error: ${fetchErr}`);
      }

      results.push(result);
    }

    return jsonResponse({
      success: true,
      data: {
        results,
        totalFetched: results.reduce((sum, r) => sum + r.fetched, 0),
        totalRecorded: results.reduce((sum, r) => sum + r.recorded, 0)
      }
    });
  } catch (error) {
    console.error('Error syncing transactions:', error);
    return errorResponse(error instanceof Error ? error.message : 'Failed to sync transactions');
  }
}

async function fetchAssetTransactions(
  asset: TrackedAsset,
  walletAddress: string,
  rpcUrl: string
): Promise<NormalizedTransaction[]> {
  const transactions: NormalizedTransaction[] = [];

  switch (asset.chain_type) {
    case 'evm': {
      if (asset.is_native) {
        // Native ETH - skip for now (requires trace API or block scanning)
        break;
      }

      if (!asset.contract_address) break;

      // ERC20 Transfer event topic
      const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
      const paddedAddress = '0x' + walletAddress.slice(2).toLowerCase().padStart(64, '0');

      try {
        // Get current block
        const blockRes = await fetch(rpcUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0', id: 1,
            method: 'eth_blockNumber',
            params: []
          })
        });

        if (!blockRes.ok) break;
        const blockData = await blockRes.json() as { result?: string };
        const currentBlock = parseInt(blockData.result || '0', 16);
        // ZAN RPC has 10,000 block limit - use 9,000 to be safe
        const fromBlock = '0x' + Math.max(0, currentBlock - 9000).toString(16);

        // Fetch received transfers
        const receivedRes = await fetch(rpcUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0', id: 1,
            method: 'eth_getLogs',
            params: [{
              address: asset.contract_address,
              fromBlock,
              toBlock: 'latest',
              topics: [TRANSFER_TOPIC, null, paddedAddress]
            }]
          })
        });

        if (receivedRes.ok) {
          const data = await receivedRes.json() as { result?: any[] };
          for (const log of (data.result || []).slice(0, 50)) {
            const tx = parseEvmTransferLog(log, asset, 'receive');
            if (tx) transactions.push(tx);
          }
        }

        // Fetch sent transfers
        const sentRes = await fetch(rpcUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0', id: 1,
            method: 'eth_getLogs',
            params: [{
              address: asset.contract_address,
              fromBlock,
              toBlock: 'latest',
              topics: [TRANSFER_TOPIC, paddedAddress, null]
            }]
          })
        });

        if (sentRes.ok) {
          const data = await sentRes.json() as { result?: any[] };
          for (const log of (data.result || []).slice(0, 50)) {
            const tx = parseEvmTransferLog(log, asset, 'send');
            if (tx) transactions.push(tx);
          }
        }
      } catch (err) {
        console.error(`EVM fetch error for ${asset.symbol} on ${asset.chain}:`, err);
      }
      break;
    }

    case 'svm': {
      // Solana - fetch SPL token transfers
      if (!asset.contract_address && !asset.is_native) break;

      try {
        let addressToQuery = walletAddress;

        // For SPL tokens, get the token account address (ATA) to query
        if (asset.contract_address) {
          const ataResponse = await fetch(rpcUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              jsonrpc: '2.0', id: 1,
              method: 'getTokenAccountsByOwner',
              params: [walletAddress, { mint: asset.contract_address }, { encoding: 'jsonParsed' }]
            })
          });

          if (ataResponse.ok) {
            const ataResult = await ataResponse.json() as { result?: { value?: any[] } };
            const tokenAccounts = ataResult.result?.value || [];
            if (tokenAccounts.length > 0) {
              // Use the token account address for querying transactions
              addressToQuery = tokenAccounts[0].pubkey;
            } else {
              // No token account exists, skip
              break;
            }
          }
        }

        const sigResponse = await fetch(rpcUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0', id: 1,
            method: 'getSignaturesForAddress',
            params: [addressToQuery, { limit: 20 }]
          })
        });

        if (sigResponse.ok) {
          const sigResult = await sigResponse.json() as { result?: any[] };
          for (const sig of sigResult.result || []) {
            const txResponse = await fetch(rpcUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                jsonrpc: '2.0', id: 1,
                method: 'getTransaction',
                params: [sig.signature, { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0 }]
              })
            });

            if (txResponse.ok) {
              const txResult = await txResponse.json() as { result?: any };
              if (txResult.result) {
                const tx = parseSolTransaction(txResult.result, walletAddress, sig, asset);
                if (tx) transactions.push(tx);
              }
            }
          }
        }
      } catch (err) {
        console.error(`Solana fetch error for ${asset.symbol}:`, err);
      }
      break;
    }

    case 'tron': {
      // Tron - fetch TRC20 transfers
      try {
        const endpoint = asset.contract_address
          ? `${rpcUrl}/v1/accounts/${walletAddress}/transactions/trc20?contract_address=${asset.contract_address}&limit=20`
          : `${rpcUrl}/v1/accounts/${walletAddress}/transactions?limit=20&only_confirmed=true`;

        const response = await fetch(endpoint);
        if (response.ok) {
          const data = await response.json() as { data?: any[] };
          for (const tx of data.data || []) {
            const parsed = parseTronTransaction(tx, walletAddress, asset);
            if (parsed) transactions.push(parsed);
          }
        }
      } catch (err) {
        console.error(`Tron fetch error for ${asset.symbol}:`, err);
      }
      break;
    }

    case 'ton': {
      // TON - fetch transactions
      try {
        const response = await fetch(`${rpcUrl}/getTransactions?address=${walletAddress}&limit=20`);
        if (response.ok) {
          const data = await response.json() as { ok?: boolean; result?: any[] };
          if (data.ok) {
            for (const tx of data.result || []) {
              const parsed = parseTonTransaction(tx, walletAddress, asset);
              if (parsed) transactions.push(parsed);
            }
          }
        }
      } catch (err) {
        console.error(`TON fetch error for ${asset.symbol}:`, err);
      }
      break;
    }

    case 'btc': {
      // Bitcoin - use REST API
      try {
        const response = await fetch(`${rpcUrl}/address/${walletAddress}/txs`);
        if (response.ok) {
          const txs = await response.json() as any[];
          for (const tx of txs.slice(0, 20)) {
            const parsed = parseBtcTransaction(tx, walletAddress, asset);
            if (parsed) transactions.push(parsed);
          }
        }
      } catch (err) {
        console.error(`BTC fetch error:`, err);
      }
      break;
    }
  }

  return transactions;
}

function parseEvmTransferLog(log: any, asset: TrackedAsset, type: 'send' | 'receive'): NormalizedTransaction | null {
  try {
    const from = '0x' + log.topics[1].slice(26).toLowerCase();
    const to = '0x' + log.topics[2].slice(26).toLowerCase();
    const amount = BigInt(log.data || '0x0');
    const formattedAmount = (Number(amount) / Math.pow(10, asset.decimals)).toFixed(Math.min(asset.decimals, 8));

    return {
      txHash: log.transactionHash,
      type,
      status: 'confirmed',
      assetSymbol: asset.symbol,
      chain: asset.chain,
      amount: formattedAmount,
      from,
      to,
      blockNumber: parseInt(log.blockNumber, 16),
      feeAsset: 'ETH'
    };
  } catch {
    return null;
  }
}

function parseSolTransaction(tx: any, walletAddress: string, sig: any, asset: TrackedAsset): NormalizedTransaction | null {
  try {
    const accountKeys = tx.transaction?.message?.accountKeys || [];

    // For SPL tokens (like USDC), use preTokenBalances/postTokenBalances
    if (asset.contract_address && !asset.is_native) {
      const preTokenBalances = tx.meta?.preTokenBalances || [];
      const postTokenBalances = tx.meta?.postTokenBalances || [];

      // Find token balance changes for this mint owned by this wallet
      const findTokenBalance = (balances: any[]) => {
        for (const bal of balances) {
          if (bal.mint === asset.contract_address && bal.owner === walletAddress) {
            return bal.uiTokenAmount?.uiAmount || 0;
          }
        }
        return 0;
      };

      const preBal = findTokenBalance(preTokenBalances);
      const postBal = findTokenBalance(postTokenBalances);
      const balanceChange = postBal - preBal;

      // Skip if no change for this token
      if (balanceChange === 0) return null;

      const type: 'send' | 'receive' = balanceChange > 0 ? 'receive' : 'send';
      const amount = Math.abs(balanceChange);

      return {
        txHash: sig.signature,
        type,
        status: tx.meta?.err ? 'failed' : 'confirmed',
        assetSymbol: asset.symbol,
        chain: asset.chain,
        amount: amount.toFixed(asset.decimals),
        from: type === 'send' ? walletAddress : 'unknown',
        to: type === 'receive' ? walletAddress : 'unknown',
        blockNumber: sig.slot,
        blockTimestamp: sig.blockTime,
        feeAsset: 'SOL'
      };
    }

    // For native SOL, use preBalances/postBalances
    const preBalances = tx.meta?.preBalances || [];
    const postBalances = tx.meta?.postBalances || [];

    let walletIndex = -1;
    for (let i = 0; i < accountKeys.length; i++) {
      const key = typeof accountKeys[i] === 'string' ? accountKeys[i] : accountKeys[i]?.pubkey;
      if (key === walletAddress) {
        walletIndex = i;
        break;
      }
    }

    if (walletIndex === -1) return null;

    const balanceChange = (postBalances[walletIndex] || 0) - (preBalances[walletIndex] || 0);
    const type: 'send' | 'receive' = balanceChange > 0 ? 'receive' : 'send';
    const amount = Math.abs(balanceChange);

    return {
      txHash: sig.signature,
      type,
      status: tx.meta?.err ? 'failed' : 'confirmed',
      assetSymbol: asset.symbol,
      chain: asset.chain,
      amount: (amount / Math.pow(10, asset.decimals)).toFixed(asset.decimals),
      from: type === 'send' ? walletAddress : 'unknown',
      to: type === 'receive' ? walletAddress : 'unknown',
      blockNumber: sig.slot,
      blockTimestamp: sig.blockTime,
      feeAsset: 'SOL'
    };
  } catch {
    return null;
  }
}

function parseTronTransaction(tx: any, walletAddress: string, asset: TrackedAsset): NormalizedTransaction | null {
  try {
    // TRC20 transaction format
    if (tx.token_info) {
      const from = tx.from || '';
      const to = tx.to || '';
      const type: 'send' | 'receive' = from.toLowerCase() === walletAddress.toLowerCase() ? 'send' : 'receive';

      return {
        txHash: tx.transaction_id,
        type,
        status: 'confirmed',
        assetSymbol: asset.symbol,
        chain: asset.chain,
        amount: (Number(tx.value || 0) / Math.pow(10, asset.decimals)).toFixed(asset.decimals),
        from,
        to,
        blockTimestamp: tx.block_timestamp ? Math.floor(tx.block_timestamp / 1000) : undefined
      };
    }

    // Native TRX transaction
    const rawData = tx.raw_data?.contract?.[0];
    if (!rawData || rawData.type !== 'TransferContract') return null;

    const value = rawData.parameter?.value || {};
    const from = value.owner_address || '';
    const to = value.to_address || '';
    const amount = value.amount || 0;

    return {
      txHash: tx.txID,
      type: from.toLowerCase().includes(walletAddress.toLowerCase().slice(2)) ? 'send' : 'receive',
      status: tx.ret?.[0]?.contractRet === 'SUCCESS' ? 'confirmed' : 'failed',
      assetSymbol: asset.symbol,
      chain: asset.chain,
      amount: (amount / Math.pow(10, asset.decimals)).toFixed(asset.decimals),
      from,
      to,
      blockNumber: tx.blockNumber,
      blockTimestamp: tx.block_timestamp ? Math.floor(tx.block_timestamp / 1000) : undefined
    };
  } catch {
    return null;
  }
}

function parseTonTransaction(tx: any, walletAddress: string, asset: TrackedAsset): NormalizedTransaction | null {
  try {
    const inMsg = tx.in_msg;
    const outMsgs = tx.out_msgs || [];

    let type: 'send' | 'receive';
    let amount: string;
    let from: string;
    let to: string;

    if (outMsgs.length > 0) {
      type = 'send';
      const outMsg = outMsgs[0];
      amount = (BigInt(outMsg.value || '0') / BigInt(Math.pow(10, asset.decimals))).toString();
      from = walletAddress;
      to = outMsg.destination?.account_address || outMsg.destination || 'unknown';
    } else if (inMsg && inMsg.source) {
      type = 'receive';
      amount = (BigInt(inMsg.value || '0') / BigInt(Math.pow(10, asset.decimals))).toString();
      from = inMsg.source?.account_address || inMsg.source || 'unknown';
      to = walletAddress;
    } else {
      return null;
    }

    return {
      txHash: tx.transaction_id?.hash || tx.hash || '',
      type,
      status: 'confirmed',
      assetSymbol: asset.symbol,
      chain: asset.chain,
      amount,
      from,
      to,
      blockTimestamp: tx.utime,
      fee: (BigInt(tx.fee || '0') / BigInt(Math.pow(10, asset.decimals))).toString(),
      feeAsset: 'TON'
    };
  } catch {
    return null;
  }
}

function parseBtcTransaction(tx: any, walletAddress: string, asset: TrackedAsset): NormalizedTransaction | null {
  try {
    let received = 0;
    let sent = 0;
    const fromAddresses: string[] = [];
    const toAddresses: string[] = [];

    for (const vin of tx.vin || []) {
      const prevAddr = vin.prevout?.scriptpubkey_address;
      if (prevAddr) {
        fromAddresses.push(prevAddr);
        if (prevAddr === walletAddress) {
          sent += vin.prevout?.value || 0;
        }
      }
    }

    for (const vout of tx.vout || []) {
      const outAddr = vout.scriptpubkey_address;
      if (outAddr) {
        toAddresses.push(outAddr);
        if (outAddr === walletAddress) {
          received += vout.value || 0;
        }
      }
    }

    const fee = tx.fee || 0;
    let type: 'send' | 'receive';
    let amount: number;

    if (sent > 0 && received > 0) {
      amount = sent - received - fee;
      type = amount > 0 ? 'send' : 'receive';
      amount = Math.abs(amount);
    } else if (sent > 0) {
      type = 'send';
      amount = sent - fee;
    } else {
      type = 'receive';
      amount = received;
    }

    return {
      txHash: tx.txid,
      type,
      status: tx.status?.confirmed ? 'confirmed' : 'pending',
      assetSymbol: asset.symbol,
      chain: asset.chain,
      amount: (amount / Math.pow(10, asset.decimals)).toFixed(asset.decimals),
      from: fromAddresses[0] || 'unknown',
      to: toAddresses.find(a => a !== walletAddress) || toAddresses[0] || 'unknown',
      blockNumber: tx.status?.block_height,
      blockTimestamp: tx.status?.block_time,
      fee: (fee / Math.pow(10, asset.decimals)).toFixed(asset.decimals),
      feeAsset: 'BTC'
    };
  } catch {
    return null;
  }
}

export async function onRequestOptions(context: { request: Request }) {
  return handleCors(context.request);
}
