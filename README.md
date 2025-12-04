# Canton Wallet - Cloudflare Pages Edition

A Canton blockchain wallet application deployed on Cloudflare Pages with Functions, using Cloudflare Tunnel to connect to your local Canton instance.

## Architecture

- **Frontend**: React app served via Cloudflare Pages
- **Backend**: Cloudflare Functions (serverless API routes)
- **Blockchain**: Canton/Splice network (connected via Cloudflare Tunnel)

## Project Structure

```
cloudflare-wallet/
├── src/                       # React frontend source
│   ├── App.tsx               # Main application component
│   ├── crypto.ts             # Client-side PRF encryption utilities
│   ├── TokenIcon.tsx         # Token icon component (web3icons)
│   └── App.css               # Styles
├── public/                    # Static assets
│   └── tokens/               # Fallback token icons
├── functions/                 # Cloudflare Functions (API routes)
│   ├── _lib/                 # Shared backend utilities
│   │   ├── utils.ts          # Helper functions, CORS, ID generation
│   │   ├── splice-client.ts  # Splice API client
│   │   ├── canton-json-client.ts  # Canton JSON API client
│   │   └── wallet-generator.ts    # Server-side wallet generation (fallback)
│   └── api/
│       ├── auth/             # Authentication endpoints
│       │   ├── passkey/      # WebAuthn passkey endpoints
│       │   │   ├── register-options.ts
│       │   │   ├── register-verify.ts
│       │   │   ├── login-options.ts
│       │   │   └── login-verify.ts
│       │   ├── validate-code.ts   # Registration code validation
│       │   ├── session.ts         # Session info
│       │   └── logout.ts          # Logout
│       ├── wallet/           # Wallet operations
│       │   ├── balance.ts
│       │   ├── addresses.ts
│       │   ├── transfer.ts
│       │   └── ...
│       └── admin/            # Admin operations
│           ├── users.ts
│           └── registration-codes.ts
├── schema.sql                # D1 database schema
├── dist/                     # Build output (generated)
└── wrangler.toml            # Cloudflare configuration
```

## Setup Instructions

### Prerequisites

1. Node.js 18+ installed
2. Canton/Splice network running locally (ports 2903, 2975)
3. Cloudflare account (free tier works)

### Step 1: Install Dependencies

```bash
cd /root/cantonlocal/cloudflare-wallet
npm install
```

### Step 2: Set Up Cloudflare Tunnel

Cloudflare Tunnel allows your Cloudflare Functions to securely connect to your local Canton instance.

#### Option A: Quick Tunnel (for testing)

```bash
# Install cloudflared
curl -L --output cloudflared.deb https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb
sudo dpkg -i cloudflared.deb

# Create a quick tunnel to expose port 2903
cloudflared tunnel --url http://localhost:2903
```

This will give you a URL like `https://random-words-1234.trycloudflare.com`. Copy this URL for the next step.

#### Option B: Named Tunnel (for production)

```bash
# Login to Cloudflare
cloudflared tunnel login

# Create a named tunnel
cloudflared tunnel create canton-tunnel

# Configure the tunnel (create config.yml)
cat > ~/.cloudflared/config.yml <<EOF
tunnel: canton-tunnel
credentials-file: ~/.cloudflared/<TUNNEL-ID>.json

ingress:
  - hostname: canton.yourdomain.com
    service: http://localhost:2903
  - service: http_status:404
EOF

# Route the tunnel
cloudflared tunnel route dns canton-tunnel canton.yourdomain.com

# Run the tunnel
cloudflared tunnel run canton-tunnel
```

### Step 3: Configure Environment Variables

Update `.dev.vars` for local development:

```bash
SPLICE_HOST=localhost
SPLICE_PORT=2903
CANTON_AUTH_SECRET=unsafe
CANTON_AUTH_USER=ledger-api-user
CANTON_AUTH_AUDIENCE=https://canton.network.global
```

For production, update `wrangler.toml` with your tunnel URL:

```toml
[env.production.vars]
SPLICE_HOST = "your-tunnel-url.trycloudflare.com"  # Your tunnel URL without https://
SPLICE_PORT = "443"  # Use 443 for HTTPS tunnels
```

### Step 4: Build the Application

```bash
npm run build
```

### Step 5: Test Locally

```bash
# In terminal 1: Run your Canton network (if not already running)
# In terminal 2: Run Cloudflare Tunnel
cloudflared tunnel --url http://localhost:2903

# In terminal 3: Run the Cloudflare Pages development server
npm run pages:dev
```

Visit `http://localhost:8788` to test the application.

### Step 6: Deploy to Cloudflare Pages

```bash
# Login to Cloudflare
npx wrangler login

# Deploy
npm run pages:deploy
```

After deployment, set environment variables in Cloudflare Dashboard:
1. Go to Workers & Pages > cloudflare-wallet > Settings > Environment variables
2. Add the following variables:
   - `SPLICE_HOST`: Your tunnel hostname (e.g., `canton-tunnel.yourdomain.com`)
   - `SPLICE_PORT`: `443` (for HTTPS tunnels)
   - `CANTON_AUTH_SECRET`: Your Canton auth secret
   - `CANTON_AUTH_USER`: `ledger-api-user`
   - `CANTON_AUTH_AUDIENCE`: `https://canton.network.global`

## API Endpoints

All endpoints are under `/api/`:

### Passkey Authentication
- `POST /api/auth/passkey/register-options` - Get WebAuthn registration options
- `POST /api/auth/passkey/register-verify` - Verify registration and create user
- `POST /api/auth/passkey/login-options` - Get WebAuthn authentication options
- `POST /api/auth/passkey/login-verify` - Verify authentication and create session
- `POST /api/auth/validate-code` - Validate a registration code
- `GET /api/auth/session` - Get current session info
- `POST /api/auth/logout` - Logout and invalidate session

### Wallet Operations
- `GET /api/wallet/balance` - Get wallet balance
- `GET /api/wallet/transactions` - Get transaction history
- `GET /api/wallet/info` - Get wallet information
- `GET /api/wallet/addresses` - Get user's chain addresses
- `POST /api/wallet/transfer` - Transfer coins
- `POST /api/wallet/tap` - Get coins from faucet
- `GET /api/wallet/transfer-offers` - List pending transfer offers
- `POST /api/wallet/transfer-offers/:contractId/accept` - Accept transfer offer

### Admin (requires admin role)
- `POST /api/admin/users` - Create new user/party
- `GET /api/admin/registration-codes` - List all registration codes
- `POST /api/admin/registration-codes` - Create a new registration code
- `DELETE /api/admin/registration-codes/:id` - Delete a registration code

## Development

### Local Development (without Cloudflare)

For pure local development, you can still use the original Express backend:

```bash
cd /root/cantonlocal/ts-wallet/backend
npm run dev
```

### Frontend Development

```bash
npm run dev
```

This starts Vite dev server at `http://localhost:5173`

## Troubleshooting

### Canton Connection Issues

If Functions can't connect to Canton:
1. Verify Cloudflare Tunnel is running: `cloudflared tunnel info`
2. Check tunnel URL is correct in environment variables
3. Test tunnel directly: `curl https://your-tunnel-url.trycloudflare.com/api/validator/v0/health`

### CORS Errors

CORS headers are included in all Function responses. If you still see errors:
1. Check browser console for the actual error
2. Verify the frontend is making requests to the correct API URL

### Build Errors

If TypeScript compilation fails:
```bash
rm -rf node_modules package-lock.json
npm install
npm run build
```

## Security Architecture

### Passkey Authentication with PRF-Based Encryption

This wallet uses WebAuthn passkeys for authentication with the PRF (Pseudo-Random Function) extension for client-side encryption of private keys. This ensures that **even the server/webmaster cannot decrypt wallet private keys** - only the user with their physical passkey can access them.

#### How It Works

1. **Registration Flow**:
   - User creates a passkey with PRF extension enabled
   - Client generates wallet addresses for all supported chains (EVM, Solana, Bitcoin, TRON, TON)
   - Private keys are encrypted client-side using AES-256-GCM with a key derived from PRF output
   - Only encrypted blobs are sent to and stored on the server
   - Server never sees plaintext private keys

2. **Login Flow**:
   - User authenticates with their passkey
   - PRF extension provides the same deterministic output as during registration
   - Client can decrypt private keys locally using the PRF-derived key
   - If user has no wallets yet (legacy migration), wallets are generated on first login

3. **Encryption Details**:
   - **PRF Salt**: Consistent salt (`canton-wallet-encryption-v1`) ensures same key derivation
   - **Key Derivation**: HKDF-SHA256 derives AES-256 key from 32-byte PRF output
   - **Encryption**: AES-256-GCM with random 96-bit IV per encryption
   - **Storage Format**: Hex-encoded (IV + ciphertext + auth tag)

#### Supported Chains

| Chain | Address Format | Example |
|-------|----------------|---------|
| EVM (Ethereum, etc.) | Hex with 0x prefix | `0x1234...abcd` |
| Solana (SVM) | Base58 | `7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU` |
| Bitcoin (BTC) | Base58Check (P2PKH) | `1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2` |
| TRON | Base58Check (0x41 prefix) | `TJCnKsPa7y5okkXvQAidZBzqx3QyQ6sxMW` |
| TON | Base64URL with CRC16 | `EQDtFpEwcFAEcRe5mLVh2N6C0x-_hJEM7W61_JLnSF74p4q2` |

#### Fallback for Non-PRF Authenticators

Some older authenticators don't support the PRF extension. For these:
- Server generates wallets with server-side encryption (AES using `CANTON_AUTH_SECRET`)
- These wallets can be decrypted by the server if needed
- Users are encouraged to use PRF-capable authenticators for maximum security

#### Security Properties

- **Zero-Knowledge Server**: Server stores only encrypted blobs, cannot decrypt without user's passkey
- **Phishing Resistant**: Passkeys are bound to the origin, preventing phishing attacks
- **No Password to Steal**: No passwords stored or transmitted
- **Hardware-Backed**: Private keys can be stored in secure enclaves (YubiKey, TPM, etc.)
- **Replay Protected**: Each authentication includes a unique challenge

### Registration Codes

New user registration requires an admin-generated registration code. This prevents unauthorized account creation.

#### Admin API

```bash
# Create a registration code (admin only)
curl -X POST https://your-domain/api/admin/registration-codes \
  -H "Authorization: Bearer <session_id>" \
  -H "Content-Type: application/json" \
  -d '{"maxUses": 10, "expiresInDays": 7, "note": "Team onboarding"}'

# List all codes
curl https://your-domain/api/admin/registration-codes \
  -H "Authorization: Bearer <session_id>"

# Delete a code
curl -X DELETE https://your-domain/api/admin/registration-codes/<code_id> \
  -H "Authorization: Bearer <session_id>"
```

#### Public Validation

```bash
# Validate a code before registration
curl -X POST https://your-domain/api/auth/validate-code \
  -H "Content-Type: application/json" \
  -d '{"code": "ABC123XYZ"}'
```

### General Security Notes

1. **Never commit `.dev.vars`** - It contains sensitive credentials
2. **Use proper auth secrets** - Replace `unsafe` with a secure secret in production
3. **Limit tunnel access** - Use named tunnels with authentication for production
4. **Review CORS settings** - Restrict origins in production (lib/utils.ts)
5. **PRF Support**: Encourage users to use modern authenticators that support PRF (Chrome 116+, Safari 17+)

## Migration from Express Backend

This project replaces the Express backend (`/root/cantonlocal/ts-wallet/backend`) with Cloudflare Functions. The original backend is preserved for reference.

Key differences:
- Express routes → Cloudflare Functions
- `app.locals` → Function `context.env`
- Middleware → Per-function CORS handling
- `process.env` → `context.env`

## Resources

- [Cloudflare Pages Documentation](https://developers.cloudflare.com/pages/)
- [Cloudflare Functions](https://developers.cloudflare.com/pages/functions/)
- [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/)
- [Canton Documentation](https://docs.digitalasset.com/)
