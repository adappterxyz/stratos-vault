# Stratos Vault

A multi-chain yield-generating vault platform where Canton Network smart contracts define and enforce investment policies.

## Live Demo

**Demo URL:** https://n1.cantondefi.com

## Project Overview

Stratos Vault is a multi-chain yield-generating vault platform where Canton Network smart contracts define and enforce investment policies. Users deposit assets into vaults that automatically rebalance across chains (Ethereum, Base, Solana, Tron, TON) based on Canton-defined parameters—target allocations, rebalancing thresholds, and risk limits. Private keys are secured using WebAuthn PRF encryption, enabling trustless client-side signing. Canton's DAML contracts serve as the policy layer, ensuring transparent governance while the wallet infrastructure executes cross-chain rebalancing autonomously.

## Problem Statement

DeFi yield vaults lack transparent, auditable policy enforcement. Users trust opaque smart contracts or centralized operators to manage allocations. There's no standardized way to define investment policies that span multiple chains while maintaining regulatory compliance and user sovereignty over keys.

## Solution & Key Features

- **Canton Policy Layer:** DAML contracts on Canton define vault policies—target allocations, rebalancing triggers, risk parameters
- **Auto-Rebalancing Engine:** When portfolio drifts beyond thresholds, the system executes cross-chain swaps to restore target weights
- **Multi-Chain Execution:** Client-side signing for EVM, Solana, Tron, TON, and Bitcoin transactions
- **WebAuthn PRF Security:** Hardware-backed key encryption—even vault operators cannot access user funds
- **Transparent Governance:** Canton's ledger provides auditable proof of policy compliance

## Tools & Technologies

- **Policy Layer:** Canton Network, DAML smart contracts, Splice API
- **Frontend:** React, TypeScript, Vite
- **Cryptography:** @noble/curves, WebAuthn PRF extension
- **Multi-Chain:** ZAN.top RPC endpoints (ETH, Base, SOL, TRX, TON, BTC)
- **Deployment:** Cloudflare Pages Functions, D1 SQLite

## Testing Instructions

The Stratos Vault wallet operates as an embedded child frame within authorized Stratos infrastructure. Direct standalone testing is not supported for security reasons—the wallet requires parent frame authentication and cross-origin messaging with approved Stratos domains.

For evaluation purposes:
1. Access the live demo at https://n1.cantondefi.com
2. Request a registration code from the Stratos team
3. Register using a WebAuthn-compatible device with PRF support (YubiKey 5.5+, TouchID, FaceID)
4. The wallet will generate encrypted multi-chain addresses
5. Vault policies and rebalancing can be configured via the admin interface

---

## Architecture

- **Frontend**: React app served via Cloudflare Pages
- **Backend**: Cloudflare Functions (serverless API routes)
- **Policy Layer**: Canton Network / Splice API
- **Multi-Chain RPC**: ZAN.top endpoints

## Project Structure

```
stratos-vault/
├── src/                       # React frontend source
│   ├── App.tsx               # Main application component
│   ├── crypto.ts             # Client-side PRF encryption utilities
│   ├── evmSigner.ts          # EVM transaction signing
│   ├── solSigner.ts          # Solana transaction signing
│   ├── btcSigner.ts          # Bitcoin transaction signing
│   ├── tronSigner.ts         # Tron transaction signing
│   ├── tonSigner.ts          # TON transaction signing
│   ├── TokenIcon.tsx         # Token icon component
│   └── App.css               # Styles
├── public/                    # Static assets
│   └── tokens/               # Fallback token icons
├── functions/                 # Cloudflare Functions (API routes)
│   ├── _lib/                 # Shared backend utilities
│   │   ├── utils.ts          # Helper functions, CORS, ID generation
│   │   ├── splice-client.ts  # Splice API client
│   │   ├── canton-json-client.ts  # Canton JSON API client
│   │   └── wallet-generator.ts    # Wallet address storage utilities
│   └── api/
│       ├── auth/             # Authentication endpoints
│       │   └── passkey/      # WebAuthn passkey endpoints
│       ├── wallet/           # Wallet operations
│       ├── canton/           # Canton contract operations
│       └── admin/            # Admin operations
├── docs/
│   ├── ARCHITECTURE.md       # System architecture documentation
│   └── REBALANCER_BOT.md     # Auto-rebalancing documentation
├── schema.sql                # D1 database schema
└── wrangler.toml            # Cloudflare configuration
```

## Setup Instructions

### Prerequisites

1. Node.js 18+ installed
2. Canton/Splice network running
3. Cloudflare account

### Step 1: Install Dependencies

```bash
npm install
```

### Step 2: Configure Environment Variables

Update `.dev.vars` for local development:

```bash
SPLICE_HOST=localhost
SPLICE_PORT=2903
CANTON_AUTH_SECRET=your-secret
CANTON_AUTH_USER=ledger-api-user
CANTON_AUTH_AUDIENCE=https://canton.network.global
```

### Step 3: Build the Application

```bash
npm run build
```

### Step 4: Deploy to Cloudflare Pages

```bash
npx wrangler login
npm run pages:deploy
```

## API Endpoints

### Passkey Authentication
- `POST /api/auth/passkey/register-options` - Get WebAuthn registration options
- `POST /api/auth/passkey/register-verify` - Verify registration and create user
- `POST /api/auth/passkey/login-options` - Get WebAuthn authentication options
- `POST /api/auth/passkey/login-verify` - Verify authentication and create session

### Wallet Operations
- `GET /api/wallet/balance` - Get wallet balance
- `GET /api/wallet/transactions` - Get transaction history
- `GET /api/wallet/info` - Get wallet information
- `POST /api/wallet/transfer` - Transfer coins

### Canton Operations
- `POST /api/canton/query` - Query Canton contracts
- `POST /api/canton/create` - Create Canton contracts
- `POST /api/canton/exercise` - Exercise Canton contract choices

### Admin
- `POST /api/admin/registration-codes` - Create registration codes
- `GET /api/admin/assets` - Manage vault assets

## Security Architecture

### WebAuthn PRF Encryption

This wallet uses WebAuthn passkeys with the PRF (Pseudo-Random Function) extension for client-side encryption of private keys. **Even the server operator cannot decrypt wallet private keys** - only the user with their physical passkey can access them.

#### Supported Chains

| Chain | Address Format | Signing Algorithm |
|-------|----------------|-------------------|
| EVM (Ethereum, Base) | 0x-prefixed hex | secp256k1 |
| Solana | Base58 | Ed25519 |
| Bitcoin | Base58Check (P2PKH) | secp256k1 |
| TRON | Base58Check (0x41) | secp256k1 |
| TON | Base64URL | Ed25519 |

#### Security Properties

- **Zero-Knowledge Server**: Server stores only encrypted blobs
- **Phishing Resistant**: Passkeys are bound to the origin
- **Hardware-Backed**: Keys can be stored in secure enclaves (YubiKey, TPM)
- **Multi-Chain**: Same passkey protects all chain wallets

## Resources

- [Canton Documentation](https://docs.digitalasset.com/)
- [Cloudflare Pages](https://developers.cloudflare.com/pages/)
- [WebAuthn PRF Extension](https://w3c.github.io/webauthn/#prf-extension)
