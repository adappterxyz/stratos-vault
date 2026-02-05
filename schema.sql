-- Users table
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  display_name TEXT,
  party_id TEXT,
  role TEXT DEFAULT 'user',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Passkey credentials table
CREATE TABLE IF NOT EXISTS passkeys (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  credential_id TEXT UNIQUE NOT NULL,
  public_key TEXT NOT NULL,
  counter INTEGER DEFAULT 0,
  device_type TEXT,
  backed_up INTEGER DEFAULT 0,
  transports TEXT,
  name TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  last_used_at DATETIME,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Sessions table for authenticated users
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  expires_at DATETIME NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Challenges table for passkey registration/authentication
CREATE TABLE IF NOT EXISTS challenges (
  id TEXT PRIMARY KEY,
  challenge TEXT UNIQUE NOT NULL,
  user_id TEXT,
  type TEXT NOT NULL,
  metadata TEXT,  -- JSON metadata (e.g., registration_code_id)
  expires_at DATETIME NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Admin sessions table
CREATE TABLE IF NOT EXISTS admin_sessions (
  id TEXT PRIMARY KEY,
  expires_at DATETIME NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Wallet addresses table for multi-chain support
CREATE TABLE IF NOT EXISTS wallet_addresses (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  chain_type TEXT NOT NULL,  -- 'evm', 'svm', 'btc', 'canton'
  address TEXT NOT NULL,
  private_key_encrypted TEXT,  -- encrypted private key for derived wallets
  derivation_path TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE(user_id, chain_type)
);

-- Assets whitelist table (base asset info)
CREATE TABLE IF NOT EXISTS assets (
  id TEXT PRIMARY KEY,
  symbol TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  icon TEXT,
  chain TEXT NOT NULL,  -- Primary chain: 'Canton', 'Ethereum', 'Bitcoin', 'Solana', 'Tron', 'TON'
  chain_type TEXT,      -- Primary chain type: 'canton', 'evm', 'btc', 'svm', 'tron', 'ton'
  contract_address TEXT, -- Primary contract address (for backwards compatibility)
  decimals INTEGER DEFAULT 18,
  is_native INTEGER DEFAULT 0,  -- 1 if native chain token (ETH, BTC, SOL, TRX, TON)
  is_enabled INTEGER DEFAULT 1,
  sort_order INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Asset chains table (multi-chain support for tokens like USDC, USDT)
CREATE TABLE IF NOT EXISTS asset_chains (
  id TEXT PRIMARY KEY,
  asset_id TEXT NOT NULL,
  chain TEXT NOT NULL,        -- 'Ethereum', 'Base', 'Tron', 'Solana', 'TON', etc.
  chain_type TEXT NOT NULL,   -- 'evm', 'tron', 'svm', 'ton', etc. (Base uses 'evm')
  contract_address TEXT,      -- Chain-specific contract address
  decimals INTEGER DEFAULT 18,
  is_enabled INTEGER DEFAULT 1,
  FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE CASCADE,
  UNIQUE(asset_id, chain)
);

-- User custom assets table (user-specific tokens)
CREATE TABLE IF NOT EXISTS user_custom_assets (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  symbol TEXT NOT NULL,
  name TEXT NOT NULL,
  icon TEXT,
  chain TEXT NOT NULL,        -- 'Ethereum', 'Tron', 'Solana', 'TON', etc.
  chain_type TEXT NOT NULL,   -- 'evm', 'tron', 'svm', 'ton', etc.
  contract_address TEXT,
  decimals INTEGER DEFAULT 18,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE(user_id, symbol, chain_type)
);

-- Registration codes table
CREATE TABLE IF NOT EXISTS registration_codes (
  id TEXT PRIMARY KEY,
  code TEXT UNIQUE NOT NULL,
  max_uses INTEGER NOT NULL DEFAULT 1,
  uses_remaining INTEGER NOT NULL DEFAULT 1,
  created_by TEXT,
  expires_at DATETIME,
  code_type TEXT DEFAULT 'general',
  reserved_username TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
);

-- Registration code usage log
CREATE TABLE IF NOT EXISTS registration_code_uses (
  id TEXT PRIMARY KEY,
  code_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  used_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (code_id) REFERENCES registration_codes(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Superadmin users table (username/password authentication)
CREATE TABLE IF NOT EXISTS superadmin_users (
  id TEXT PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  is_superadmin INTEGER DEFAULT 0,  -- 1 if has superadmin privileges
  display_name TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  created_by TEXT,
  FOREIGN KEY (created_by) REFERENCES superadmin_users(id) ON DELETE SET NULL
);

-- Superadmin sessions table
CREATE TABLE IF NOT EXISTS superadmin_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  expires_at DATETIME NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES superadmin_users(id) ON DELETE CASCADE
);

-- Configuration overrides table (overrides wrangler.toml values)
CREATE TABLE IF NOT EXISTS config_overrides (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_by TEXT,
  FOREIGN KEY (updated_by) REFERENCES superadmin_users(id) ON DELETE SET NULL
);

-- Dock apps table (replaces DOCK_APPS in wrangler.toml)
CREATE TABLE IF NOT EXISTS apps (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  icon TEXT NOT NULL,             -- Icon character or emoji
  color TEXT DEFAULT '#6366f1',   -- Background color (hex)
  url TEXT,                       -- App URL (null for built-in apps)
  sort_order INTEGER DEFAULT 0,   -- Display order
  is_enabled INTEGER DEFAULT 1,   -- Can disable without deleting
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- RPC endpoints table (multi-chain RPC configuration with failover support)
CREATE TABLE IF NOT EXISTS rpc_endpoints (
  id TEXT PRIMARY KEY,
  chain_type TEXT NOT NULL,       -- 'evm', 'btc', 'svm', 'tron', 'ton'
  chain_name TEXT,                -- Display name matching assets table: 'Ethereum', 'Base', 'Bitcoin', 'Solana', 'Tron', 'TON'
  chain_id TEXT,                  -- EVM chain ID: '1' (Ethereum), '11155111' (Sepolia), '8453' (Base), etc.
  network TEXT NOT NULL,          -- 'mainnet' or 'testnet'
  name TEXT,                      -- Provider-specific name: 'ZAN Ethereum Mainnet'
  rpc_url TEXT NOT NULL,          -- The actual RPC endpoint URL
  priority INTEGER DEFAULT 0,     -- Lower number = higher priority (0 = primary, 1 = first fallback, etc.)
  is_enabled INTEGER DEFAULT 1,   -- Can disable without deleting
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(chain_type, chain_name, network, priority)
);

-- Transactions table (records all inflow/outflow for user accounts)
CREATE TABLE IF NOT EXISTS transactions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  tx_hash TEXT,                     -- Blockchain transaction hash or Canton event_id
  tx_type TEXT NOT NULL,            -- 'send', 'receive', 'swap', 'bridge', 'tap', 'fee'
  status TEXT DEFAULT 'pending',    -- 'pending', 'confirmed', 'failed'

  -- Asset info
  asset_symbol TEXT NOT NULL,       -- 'CC', 'ETH', 'USDC', 'BTC', 'SOL', etc.
  chain TEXT NOT NULL,              -- 'Canton', 'Ethereum', 'Base', 'Bitcoin', 'Solana', 'Tron', 'TON'
  chain_type TEXT NOT NULL,         -- 'canton', 'evm', 'btc', 'svm', 'tron', 'ton'

  -- Amount info
  amount TEXT NOT NULL,             -- Amount as string to preserve precision
  amount_usd TEXT,                  -- USD value at time of transaction (optional)
  fee TEXT,                         -- Transaction fee
  fee_asset TEXT,                   -- Fee asset symbol (e.g., 'ETH' for gas)

  -- Parties
  from_address TEXT,                -- Sender address or party_id
  to_address TEXT,                  -- Recipient address or party_id

  -- Metadata
  description TEXT,                 -- User-provided or auto-generated description
  metadata TEXT,                    -- JSON for extra data (contract calls, swap details, etc.)

  -- Timestamps
  block_number INTEGER,             -- Block number (for blockchain txs)
  block_timestamp DATETIME,         -- When the transaction was mined/confirmed
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- User app access control (junction table)
CREATE TABLE IF NOT EXISTS user_app_access (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  app_id TEXT NOT NULL,
  granted_by TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (app_id) REFERENCES apps(id) ON DELETE CASCADE,
  UNIQUE(user_id, app_id)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_user_app_access_user_id ON user_app_access(user_id);
CREATE INDEX IF NOT EXISTS idx_user_app_access_app_id ON user_app_access(app_id);
CREATE INDEX IF NOT EXISTS idx_registration_codes_code ON registration_codes(code);
CREATE INDEX IF NOT EXISTS idx_registration_code_uses_code_id ON registration_code_uses(code_id);
CREATE INDEX IF NOT EXISTS idx_passkeys_user_id ON passkeys(user_id);
CREATE INDEX IF NOT EXISTS idx_passkeys_credential_id ON passkeys(credential_id);
CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_challenges_challenge ON challenges(challenge);
CREATE INDEX IF NOT EXISTS idx_challenges_expires_at ON challenges(expires_at);
CREATE INDEX IF NOT EXISTS idx_admin_sessions_expires_at ON admin_sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_wallet_addresses_user_id ON wallet_addresses(user_id);
CREATE INDEX IF NOT EXISTS idx_wallet_addresses_chain_type ON wallet_addresses(chain_type);
CREATE INDEX IF NOT EXISTS idx_asset_chains_asset_id ON asset_chains(asset_id);
CREATE INDEX IF NOT EXISTS idx_asset_chains_chain_type ON asset_chains(chain_type);
CREATE INDEX IF NOT EXISTS idx_assets_symbol ON assets(symbol);
CREATE INDEX IF NOT EXISTS idx_assets_chain ON assets(chain);
CREATE INDEX IF NOT EXISTS idx_assets_is_enabled ON assets(is_enabled);
CREATE INDEX IF NOT EXISTS idx_user_custom_assets_user_id ON user_custom_assets(user_id);
CREATE INDEX IF NOT EXISTS idx_superadmin_users_username ON superadmin_users(username);
CREATE INDEX IF NOT EXISTS idx_superadmin_sessions_user_id ON superadmin_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_superadmin_sessions_expires_at ON superadmin_sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_rpc_endpoints_chain_network ON rpc_endpoints(chain_type, network);
CREATE INDEX IF NOT EXISTS idx_rpc_endpoints_priority ON rpc_endpoints(priority);
CREATE INDEX IF NOT EXISTS idx_apps_sort_order ON apps(sort_order);
CREATE INDEX IF NOT EXISTS idx_apps_is_enabled ON apps(is_enabled);
CREATE INDEX IF NOT EXISTS idx_transactions_user_id ON transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_transactions_user_created ON transactions(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_transactions_chain_type ON transactions(chain_type);
CREATE INDEX IF NOT EXISTS idx_transactions_status ON transactions(status);
CREATE INDEX IF NOT EXISTS idx_transactions_tx_hash ON transactions(tx_hash);

-- Add Base chain support for ETH (multi-chain ETH)
-- Note: This assumes an 'eth' asset already exists in the assets table
-- Run this after assets are seeded: INSERT OR IGNORE INTO asset_chains (id, asset_id, chain, chain_type, contract_address, decimals, is_enabled) SELECT 'eth-base', id, 'Base', 'evm', NULL, 18, 1 FROM assets WHERE symbol = 'ETH';
