# Stratos Wallet SDK Architecture

## Overview

The Stratos Wallet system consists of three main components:

1. **Cloudflare Wallet** - Parent application hosting the wallet UI
2. **Stratos Wallet SDK** - NPM package for child apps to communicate with the wallet
3. **Child Apps** (e.g., Privamargin) - DApps running in iframes that use the SDK

## System Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│  Cloudflare Pages (n1.cantondefi.com)                                   │
│                                                                         │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │  Cloudflare Wallet (Parent App)                                   │  │
│  │                                                                   │  │
│  │  Responsibilities:                                                │  │
│  │  • Main wallet UI and navigation                                  │  │
│  │  • Canton authentication (JWT generation)                         │  │
│  │  • Party/user identity management                                 │  │
│  │  • Exposes SDK interface via postMessage                          │  │
│  │  • Hosts child apps in iframes                                    │  │
│  │                                                                   │  │
│  │  ┌─────────────────────────────────────────────────────────────┐  │  │
│  │  │  <iframe src="https://privamargin.pages.dev">               │  │  │
│  │  │                                                             │  │  │
│  │  │  Child App (e.g., Privamargin)                              │  │  │
│  │  │                                                             │  │  │
│  │  │  • Imports @stratos-wallet/sdk                              │  │  │
│  │  │  • Calls sdk.cantonCreate(), sdk.cantonQuery(),             │  │  │
│  │  │    sdk.cantonExercise()                                     │  │  │
│  │  │  • SDK communicates with parent via postMessage             │  │  │
│  │  │  • No direct access to Canton credentials                   │  │  │
│  │  │                                                             │  │  │
│  │  └─────────────────────────────────────────────────────────────┘  │  │
│  │                                                                   │  │
│  └───────────────────────────────────────────────────────────────────┘  │
│                                                                         │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │  Cloudflare Worker Functions (/api/canton/*)                      │  │
│  │                                                                   │  │
│  │  • Receives requests from wallet frontend                         │  │
│  │  • Generates JWT tokens for Canton authentication                 │  │
│  │  • Proxies requests to Canton JSON API                            │  │
│  │  • Handles response transformation                                │  │
│  │                                                                   │  │
│  └───────────────────────────────────────────────────────────────────┘  │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    │ Cloudflare Tunnel
                                    │ (cloudflared)
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  Canton Node (localhost)                                                │
│                                                                         │
│  ┌─────────────────────────────┐  ┌─────────────────────────────────┐  │
│  │  JSON API (port 2975)       │  │  Validator API (port 2903)      │  │
│  │                             │  │                                 │  │
│  │  Endpoints:                 │  │  Endpoints:                     │  │
│  │  • /v2/commands/*           │  │  • /api/validator/*             │  │
│  │  • /v2/state/*              │  │                                 │  │
│  │  • /v2/parties              │  │                                 │  │
│  │  • /v2/packages             │  │                                 │  │
│  │                             │  │                                 │  │
│  └─────────────────────────────┘  └─────────────────────────────────┘  │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

## Request Flow

### Step-by-Step: Creating a Contract

```
┌──────────────┐    ┌──────────────┐    ┌──────────────┐    ┌──────────────┐    ┌──────────────┐
│  Child App   │    │    SDK       │    │   Parent     │    │   Worker     │    │   Canton     │
│ (Privamargin)│    │              │    │   Wallet     │    │  Function    │    │  JSON API    │
└──────┬───────┘    └──────┬───────┘    └──────┬───────┘    └──────┬───────┘    └──────┬───────┘
       │                   │                   │                   │                   │
       │ 1. cantonCreate() │                   │                   │                   │
       │──────────────────>│                   │                   │                   │
       │                   │                   │                   │                   │
       │                   │ 2. postMessage    │                   │                   │
       │                   │──────────────────>│                   │                   │
       │                   │                   │                   │                   │
       │                   │                   │ 3. fetch(/api/    │                   │
       │                   │                   │    canton/create) │                   │
       │                   │                   │──────────────────>│                   │
       │                   │                   │                   │                   │
       │                   │                   │                   │ 4. Generate JWT   │
       │                   │                   │                   │    + POST request │
       │                   │                   │                   │──────────────────>│
       │                   │                   │                   │                   │
       │                   │                   │                   │ 5. Contract       │
       │                   │                   │                   │    created        │
       │                   │                   │                   │<──────────────────│
       │                   │                   │                   │                   │
       │                   │                   │ 6. Response       │                   │
       │                   │                   │<──────────────────│                   │
       │                   │                   │                   │                   │
       │                   │ 7. postMessage    │                   │                   │
       │                   │<──────────────────│                   │                   │
       │                   │                   │                   │                   │
       │ 8. Promise        │                   │                   │                   │
       │    resolves       │                   │                   │                   │
       │<──────────────────│                   │                   │                   │
       │                   │                   │                   │                   │
```

### Detailed Flow Description

1. **Child App calls SDK method**
   ```typescript
   // In privamargin/src/services/api.ts
   const sdk = getSDK();
   const result = await sdk.cantonCreate({
     templateId: "packageId:Module:Template",
     payload: { field1: "value1", ... }
   });
   ```

2. **SDK sends postMessage to parent window**
   ```javascript
   // SDK internally does:
   window.parent.postMessage({
     type: 'stratos-wallet-request',
     action: 'canton-create',
     requestId: 'unique-id',
     data: { templateId, payload }
   }, '*');
   ```

3. **Parent wallet receives and processes message**
   - Validates the request origin
   - Adds user's party ID to the request
   - Forwards to Cloudflare Worker function

4. **Worker function authenticates and proxies**
   ```typescript
   // functions/api/canton/create.ts
   const client = new CantonJsonClient({
     host: 'p1-json.cantondefi.com',
     port: 443,
     authSecret: env.CANTON_AUTH_SECRET,
     authUser: userId,
     authAudience: 'https://canton.network.global'
   });

   const result = await client.createContract(actAs, templateId, payload);
   ```

5. **Canton processes the command**
   - Validates JWT token
   - Executes Daml transaction
   - Returns contract ID

6-8. **Response propagates back**
   - Worker returns JSON response
   - Parent wallet forwards via postMessage
   - SDK resolves the Promise

## Component Details

### Cloudflare Wallet (Parent)

**Location:** `/root/cantonlocal/cloudflare-wallet/`

**Key Files:**
| File | Purpose |
|------|---------|
| `src/App.tsx` | Main application, iframe management |
| `src/components/AppFrame.tsx` | Renders child apps in iframes |
| `src/hooks/useSDKBridge.ts` | Handles postMessage communication |
| `functions/api/canton/[action].ts` | Worker function for Canton API |
| `functions/_lib/canton-json-client.ts` | Canton JSON API client |

**Responsibilities:**
- User authentication and session management
- Party ID allocation and management
- Hosting child applications in iframes
- Bridging SDK requests to Canton API
- JWT token generation for Canton

### Stratos Wallet SDK

**Package:** `@stratos-wallet/sdk`

**Usage in child apps:**
```typescript
import { getSDK } from '@stratos-wallet/sdk';

// Check if running in iframe
const isInIframe = window.parent !== window;
const sdk = isInIframe ? getSDK() : null;

// Use SDK methods
if (sdk) {
  // Query contracts
  const contracts = await sdk.cantonQuery({
    templateId: 'packageId:Module:Template',
    filter: { owner: partyId }
  });

  // Create contract
  const result = await sdk.cantonCreate({
    templateId: 'packageId:Module:Template',
    payload: { ... }
  });

  // Exercise choice
  const exerciseResult = await sdk.cantonExercise({
    contractId: 'contract-id',
    templateId: 'packageId:Module:Template',
    choice: 'ChoiceName',
    argument: { ... }
  });

  // Get current user's party
  const party = await sdk.getParty();
}
```

**SDK Methods:**
| Method | Description |
|--------|-------------|
| `getSDK()` | Returns SDK instance (only works in iframe) |
| `sdk.getParty()` | Get current user's party ID |
| `sdk.cantonQuery(opts)` | Query active contracts |
| `sdk.cantonCreate(opts)` | Create a new contract |
| `sdk.cantonExercise(opts)` | Exercise a choice on a contract |

### Child Apps (e.g., Privamargin)

**Location:** `/root/cantonlocal/privamargin/`

**Key Files:**
| File | Purpose |
|------|---------|
| `src/services/api.ts` | API layer using SDK for Canton operations |
| `src/pages/*.tsx` | UI components |

**Pattern for SDK usage:**
```typescript
// src/services/api.ts
import { getSDK } from '@stratos-wallet/sdk';

const isInIframe = window.parent !== window;
const sdk = isInIframe ? getSDK() : null;

export const vaultAPI = {
  create: async (owner: string, vaultId: string) => {
    if (sdk) {
      try {
        const result = await sdk.cantonCreate({
          templateId: TEMPLATE_IDS.VAULT,
          payload: { vaultId, owner, operator: owner, ... }
        });
        return { data: { contractId: result.contractId } };
      } catch (error) {
        console.warn('Canton failed, using mock:', error);
      }
    }
    // Fallback to mock data for development
    return { data: mockVault };
  }
};
```

## Cloudflare Tunnel Configuration

**Location:** `/etc/cloudflared/config.yml`

```yaml
tunnel: canton-tunnel
credentials-file: ~/.cloudflared/<tunnel-id>.json

ingress:
  # App-User Validator API
  - hostname: p1.cantondefi.com
    path: /api/validator/*
    service: http://localhost:2903

  # App-User JSON API (Canton)
  - hostname: p1-json.cantondefi.com
    service: http://localhost:2975

  # App-Provider Validator API
  - hostname: p2.cantondefi.com
    path: /api/validator/*
    service: http://localhost:3903

  # App-Provider JSON API (Canton)
  - hostname: p2-json.cantondefi.com
    service: http://localhost:3975

  # Catch-all
  - service: http_status:404
```

## Canton JSON API v2

### Authentication

All requests to Canton require a JWT token:

```typescript
const token = jwt.sign(
  {
    aud: 'https://canton.network.global',  // Audience
    sub: userId,                            // User ID
    exp: Math.floor(Date.now() / 1000) + 3600  // 1 hour expiry
  },
  authSecret,  // Shared secret (e.g., 'unsafe' for dev)
  { algorithm: 'HS256' }
);
```

### Key Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/v2/commands/submit-and-wait-for-transaction` | POST | Create contracts, exercise choices |
| `/v2/state/active-contracts` | POST | Query active contracts |
| `/v2/state/ledger-end` | GET | Get current ledger offset |
| `/v2/parties` | GET/POST | List/allocate parties |
| `/v2/users` | POST | Create users |
| `/v2/users/{id}/rights` | POST | Grant user rights |

### Request Format: Create Contract

```json
{
  "commands": {
    "commands": [
      {
        "CreateCommand": {
          "templateId": "packageId:Module:Template",
          "createArguments": {
            "field1": "value1",
            "field2": "value2"
          }
        }
      }
    ],
    "commandId": "unique-command-id",
    "actAs": ["party-id"],
    "readAs": ["party-id"]
  }
}
```

### Request Format: Exercise Choice

```json
{
  "commands": {
    "commands": [
      {
        "ExerciseCommand": {
          "templateId": "packageId:Module:Template",
          "contractId": "contract-id",
          "choice": "ChoiceName",
          "choiceArgument": {
            "arg1": "value1"
          }
        }
      }
    ],
    "commandId": "unique-command-id",
    "actAs": ["party-id"],
    "readAs": ["party-id"]
  }
}
```

### Response Format

```json
{
  "transaction": {
    "events": [
      {
        "CreatedEvent": {
          "contractId": "00abcd...",
          "templateId": "packageId:Module:Template",
          "createArgument": { ... },
          "signatories": ["party1"],
          "observers": ["party2"]
        }
      }
    ]
  }
}
```

## Security Model

```
┌─────────────────────────────────────────────────────────────────┐
│                      Security Boundaries                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Child App (iframe)                                             │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │ • No access to Canton credentials                         │  │
│  │ • No access to parent window (same-origin policy)         │  │
│  │ • Can only communicate via postMessage                    │  │
│  │ • SDK validates responses from parent                     │  │
│  └───────────────────────────────────────────────────────────┘  │
│                              ▲                                  │
│                              │ postMessage (sandboxed)          │
│                              ▼                                  │
│  Parent Wallet                                                  │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │ • Validates request origins                               │  │
│  │ • Controls which apps can access Canton                   │  │
│  │ • Manages user sessions                                   │  │
│  │ • Never exposes JWT secret to frontend                    │  │
│  └───────────────────────────────────────────────────────────┘  │
│                              ▲                                  │
│                              │ HTTPS                            │
│                              ▼                                  │
│  Cloudflare Worker                                              │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │ • JWT secret stored in environment variables              │  │
│  │ • Generates short-lived tokens                            │  │
│  │ • Runs in isolated V8 environment                         │  │
│  └───────────────────────────────────────────────────────────┘  │
│                              ▲                                  │
│                              │ Cloudflare Tunnel (encrypted)    │
│                              ▼                                  │
│  Canton Node                                                    │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │ • Validates JWT on every request                          │  │
│  │ • Enforces Daml authorization rules                       │  │
│  │ • Only allows actions user's party is authorized for      │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## Development Setup

### Prerequisites

- Node.js 18+
- Cloudflare account with Pages and Workers
- Canton node running (via cn-quickstart)
- Cloudflare Tunnel configured

### Running Locally

1. **Start Canton (cn-quickstart)**
   ```bash
   cd /root/cantonlocal/cn-quickstart
   make start
   ```

2. **Start Cloudflare Tunnel**
   ```bash
   sudo systemctl start cloudflared
   ```

3. **Run Cloudflare Wallet (dev mode)**
   ```bash
   cd /root/cantonlocal/cloudflare-wallet
   npm run dev
   ```

4. **Run Child App (dev mode)**
   ```bash
   cd /root/cantonlocal/privamargin
   npm run dev
   ```

### Deployment

```bash
# Deploy wallet
cd /root/cantonlocal/cloudflare-wallet
npm run build
npx wrangler pages deploy dist --project-name cloudflare-wallet-app-user

# Deploy child app
cd /root/cantonlocal/privamargin
npm run build
npx wrangler pages deploy dist --project-name privamargin
```

## Troubleshooting

### Common Issues

| Issue | Cause | Solution |
|-------|-------|----------|
| SDK returns null | App not in iframe | Check `window.parent !== window` |
| 404 from Canton API | Wrong tunnel config | Verify `/etc/cloudflared/config.yml` |
| JWT errors | Wrong secret/audience | Check `authSecret` and `authAudience` |
| Contract not found | Wrong template ID | Verify package ID matches deployed DAR |
| Missing field errors | Wrong payload format | Check Daml template for required fields |

### Debug Tips

1. **Check browser console** for postMessage errors
2. **Check Network tab** for API request/response
3. **Check cloudflared logs**: `journalctl -u cloudflared -f`
4. **Test Canton directly**:
   ```bash
   curl -X POST https://p1-json.cantondefi.com/v2/parties \
     -H "Authorization: Bearer $TOKEN" \
     -H "Content-Type: application/json"
   ```
