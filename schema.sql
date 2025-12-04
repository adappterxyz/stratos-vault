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
  chain TEXT NOT NULL,        -- 'Ethereum', 'Tron', 'Solana', 'TON', etc.
  chain_type TEXT NOT NULL,   -- 'evm', 'tron', 'svm', 'ton', etc.
  contract_address TEXT,      -- Chain-specific contract address
  decimals INTEGER DEFAULT 18,
  is_enabled INTEGER DEFAULT 1,
  FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE CASCADE,
  UNIQUE(asset_id, chain_type)
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

-- Indexes
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
