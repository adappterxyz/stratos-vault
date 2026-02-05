-- Cloudflare Wallet - Default Seed Data
-- Run this after applying schema.sql to populate default assets and RPC endpoints

-- Default Assets
INSERT OR IGNORE INTO assets (id, symbol, name, icon, chain, chain_type, decimals, is_native, is_enabled, sort_order)
VALUES
  ('cc', 'CC', 'Canton Coin', 'C', 'Canton', 'canton', 18, 0, 1, 0),
  ('eth', 'ETH', 'Ethereum', 'E', 'Ethereum', 'evm', 18, 1, 1, 1),
  ('btc', 'BTC', 'Bitcoin', 'B', 'Bitcoin', 'btc', 8, 1, 1, 2),
  ('sol', 'SOL', 'Solana', 'S', 'Solana', 'svm', 9, 1, 1, 3),
  ('trx', 'TRX', 'Tron', 'T', 'Tron', 'tron', 6, 1, 1, 4),
  ('ton', 'TON', 'TON', 'T', 'TON', 'ton', 9, 1, 1, 5),
  ('usdc', 'USDC', 'USD Coin', 'U', 'Ethereum', 'evm', 6, 0, 1, 10),
  ('usdt', 'USDT', 'Tether', 'T', 'Ethereum', 'evm', 6, 0, 1, 11);

-- Multi-chain support for USDC
INSERT OR IGNORE INTO asset_chains (id, asset_id, chain, chain_type, contract_address, decimals, is_enabled)
VALUES
  ('usdc-eth', 'usdc', 'Ethereum', 'evm', '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', 6, 1),
  ('usdc-base', 'usdc', 'Base', 'evm', '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', 6, 1),
  ('usdc-sol', 'usdc', 'Solana', 'svm', 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', 6, 1),
  ('usdc-tron', 'usdc', 'Tron', 'tron', 'TEkxiTehnzSmSe2XqrBj4w32RUN966rdz8', 6, 1);

-- Multi-chain support for USDT
INSERT OR IGNORE INTO asset_chains (id, asset_id, chain, chain_type, contract_address, decimals, is_enabled)
VALUES
  ('usdt-eth', 'usdt', 'Ethereum', 'evm', '0xdAC17F958D2ee523a2206206994597C13D831ec7', 6, 1),
  ('usdt-tron', 'usdt', 'Tron', 'tron', 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t', 6, 1),
  ('usdt-sol', 'usdt', 'Solana', 'svm', 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', 6, 1),
  ('usdt-ton', 'usdt', 'TON', 'ton', 'EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs', 6, 1);

-- ETH on Base
INSERT OR IGNORE INTO asset_chains (id, asset_id, chain, chain_type, contract_address, decimals, is_enabled)
VALUES
  ('eth-base', 'eth', 'Base', 'evm', NULL, 18, 1);

-- Default RPC Endpoints (ZAN API - Mainnet)
INSERT OR IGNORE INTO rpc_endpoints (id, chain_type, chain_name, chain_id, network, name, rpc_url, priority, is_enabled)
VALUES
  -- Ethereum Mainnet
  ('evm-eth-mainnet', 'evm', 'Ethereum', '1', 'mainnet', 'ZAN Ethereum Mainnet', 'https://api.zan.top/node/v1/eth/mainnet/4a6373aaef354ba88416fbe73cd1c616', 0, 1),

  -- Base Mainnet
  ('evm-base-mainnet', 'evm', 'Base', '8453', 'mainnet', 'ZAN Base Mainnet', 'https://api.zan.top/node/v1/base/mainnet/4a6373aaef354ba88416fbe73cd1c616', 0, 1),

  -- Solana Mainnet
  ('svm-mainnet', 'svm', 'Solana', NULL, 'mainnet', 'ZAN Solana Mainnet', 'https://api.zan.top/node/v1/solana/mainnet/4a6373aaef354ba88416fbe73cd1c616', 0, 1),

  -- Bitcoin Mainnet
  ('btc-mainnet', 'btc', 'Bitcoin', NULL, 'mainnet', 'ZAN Bitcoin Mainnet', 'https://api.zan.top/node/v1/btc/mainnet/4a6373aaef354ba88416fbe73cd1c616', 0, 1),

  -- Tron Mainnet
  ('tron-mainnet', 'tron', 'Tron', NULL, 'mainnet', 'ZAN Tron Mainnet', 'https://api.zan.top/node/v1/tron/mainnet/4a6373aaef354ba88416fbe73cd1c616', 0, 1),

  -- TON Mainnet
  ('ton-mainnet', 'ton', 'TON', NULL, 'mainnet', 'ZAN TON Mainnet', 'https://api.zan.top/node/v1/ton/mainnet/4a6373aaef354ba88416fbe73cd1c616', 0, 1);

-- Default RPC Endpoints (ZAN API - Testnet)
INSERT OR IGNORE INTO rpc_endpoints (id, chain_type, chain_name, chain_id, network, name, rpc_url, priority, is_enabled)
VALUES
  -- Ethereum Sepolia
  ('evm-eth-testnet', 'evm', 'Ethereum', '11155111', 'testnet', 'ZAN Sepolia Testnet', 'https://api.zan.top/node/v1/eth/sepolia/4a6373aaef354ba88416fbe73cd1c616', 0, 1),

  -- Base Sepolia
  ('evm-base-testnet', 'evm', 'Base', '84532', 'testnet', 'ZAN Base Testnet', 'https://api.zan.top/node/v1/base/testnet/4a6373aaef354ba88416fbe73cd1c616', 0, 1),

  -- Solana Devnet
  ('svm-testnet', 'svm', 'Solana', NULL, 'testnet', 'ZAN Solana Devnet', 'https://api.zan.top/node/v1/solana/devnet/4a6373aaef354ba88416fbe73cd1c616', 0, 1),

  -- Bitcoin Testnet
  ('btc-testnet', 'btc', 'Bitcoin', NULL, 'testnet', 'ZAN Bitcoin Testnet', 'https://api.zan.top/node/v1/btc/testnet/4a6373aaef354ba88416fbe73cd1c616', 0, 1),

  -- Tron Shasta
  ('tron-testnet', 'tron', 'Tron', NULL, 'testnet', 'ZAN Tron Shasta', 'https://api.zan.top/node/v1/tron/shasta/4a6373aaef354ba88416fbe73cd1c616', 0, 1),

  -- TON Testnet
  ('ton-testnet', 'ton', 'TON', NULL, 'testnet', 'ZAN TON Testnet', 'https://api.zan.top/node/v1/ton/testnet/4a6373aaef354ba88416fbe73cd1c616', 0, 1);

-- Default Dock Apps
INSERT OR IGNORE INTO apps (id, name, icon, color, url, sort_order, is_enabled)
VALUES
  ('swap', 'Trade', '⇄', '#3b82f6', 'https://swap.cantondefi.com', 0, 1),
  ('nft', 'RWA', '🖼', '#8b5cf6', 'https://rwa.cantondefi.com', 1, 1),
  ('defi', 'Vault', 'ꗃ', '#10b981', 'https://vault.cantondefi.com', 2, 1);
