# Rebalancer Bot Integration

## Architecture

The rebalancer bot connects **directly to Canton JSON API** - it does NOT go through cloudflare-wallet. The cloudflare-wallet is only for browser-based UI apps using the SDK.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                                                                             │
│   Rebalancer Bot (standalone)                                               │
│   ┌─────────────────┐                                                       │
│   │                 │                                                       │
│   │  1. Query       │ ──────> Canton JSON API (p1-json.cantondefi.com)     │
│   │     policy      │         /v2/state/active-contracts                    │
│   │                 │                                                       │
│   │  2. Read EVM    │ ──────> EVM RPC (Ethereum/Polygon/etc)               │
│   │     state       │         vault.getPositions()                          │
│   │                 │                                                       │
│   │  3. Execute     │ ──────> EVM RPC                                       │
│   │     rebalance   │         vault.rebalance()                             │
│   │                 │                                                       │
│   │  4. Report to   │ ──────> Canton JSON API                               │
│   │     Canton      │         /v2/commands/submit-and-wait-for-transaction  │
│   │                 │                                                       │
│   └─────────────────┘                                                       │
│                                                                             │
│   Cloudflare Wallet (SEPARATE - browser UI only)                            │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │  Parent Wallet ──> iframe (stratos-vault) ──> SDK ──> Canton        │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Rebalancer Bot Implementation

```typescript
// rebalancer/src/canton-json-client.ts
// Copy from: /root/cantonlocal/cloudflare-wallet/functions/_lib/canton-json-client.ts

import * as jwt from 'jsonwebtoken';

export interface CantonJsonConfig {
  host: string;
  port: number;
  authSecret: string;
  authUser: string;
  authAudience: string;
}

export class CantonJsonClient {
  private config: CantonJsonConfig;
  private baseUrl: string;

  constructor(config: CantonJsonConfig) {
    this.config = config;
    const protocol = config.port === 443 ? 'https' : 'http';
    const port = config.port === 443 ? '' : `:${config.port}`;
    this.baseUrl = `${protocol}://${config.host}${port}/v2`;
  }

  private generateToken(): string {
    return jwt.sign(
      {
        aud: this.config.authAudience,
        sub: this.config.authUser,
        exp: Math.floor(Date.now() / 1000) + 3600
      },
      this.config.authSecret,
      { algorithm: 'HS256' }
    );
  }

  private async fetch<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const token = this.generateToken();
    const response = await fetch(`${this.baseUrl}${endpoint}`, {
      ...options,
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...options.headers
      }
    });

    if (!response.ok) {
      throw new Error(`Canton API error: ${response.status}`);
    }

    return response.json();
  }

  async queryContracts(actAs: string, templateId: string, filter?: Record<string, unknown>) {
    const offset = await this.getLedgerEnd();

    const result = await this.fetch<any[]>('/state/active-contracts', {
      method: 'POST',
      body: JSON.stringify({
        filter: {
          filtersByParty: {
            [actAs]: {
              cumulative: [{
                identifierFilter: {
                  TemplateFilter: {
                    value: { templateId, includeCreatedEventBlob: false }
                  }
                }
              }]
            }
          }
        },
        verbose: true,
        activeAtOffset: offset
      })
    });

    return (result || []).map(c => ({
      contractId: c.contractEntry.JsActiveContract.createdEvent.contractId,
      templateId,
      payload: c.contractEntry.JsActiveContract.createdEvent.createArgument,
      createdAt: c.contractEntry.JsActiveContract.createdEvent.createdAt
    })).filter(c => {
      if (!filter) return true;
      return Object.entries(filter).every(([k, v]) => c.payload[k] === v);
    });
  }

  async exerciseChoice(actAs: string, contractId: string, templateId: string, choice: string, argument: Record<string, unknown>) {
    const commandId = crypto.randomUUID();
    return this.fetch('/commands/submit-and-wait-for-transaction', {
      method: 'POST',
      body: JSON.stringify({
        commands: {
          commands: [{
            ExerciseCommand: { templateId, contractId, choice, choiceArgument: argument }
          }],
          commandId,
          actAs: [actAs],
          readAs: [actAs]
        }
      })
    });
  }

  async getLedgerEnd(): Promise<string> {
    const result = await this.fetch<{ offset: string }>('/state/ledger-end');
    return result.offset;
  }
}
```

```typescript
// rebalancer/src/index.ts

import { ethers } from 'ethers';
import { CantonJsonClient } from './canton-json-client';

const PACKAGE_ID = '3e0418bde138fe51f2540b0786dc758069c802041b794e61dd50f498d85ce039';

const VAULT_ABI = [
  'function getOracleData() view returns (uint256, uint256, uint256, uint256, uint256)',
  'function getPositions() view returns (tuple(address token, uint256 amount, uint256 valueUSD)[])',
  'function rebalance(address fromToken, address toToken, uint256 amount, string protocol) returns (uint256)'
];

class VaultRebalancer {
  private cantonClient: CantonJsonClient;
  private evmProvider: ethers.JsonRpcProvider;
  private evmSigner: ethers.Wallet;
  private vaultContract: ethers.Contract;
  private operatorParty: string;

  constructor(config: {
    cantonHost: string;
    cantonAuthSecret: string;
    operatorParty: string;
    evmRpcUrl: string;
    vaultAddress: string;
    operatorKey: string;
  }) {
    this.operatorParty = config.operatorParty;

    // Direct Canton connection
    this.cantonClient = new CantonJsonClient({
      host: config.cantonHost,
      port: 443,
      authSecret: config.cantonAuthSecret,
      authUser: config.operatorParty,
      authAudience: 'https://canton.network.global'
    });

    // EVM connection
    this.evmProvider = new ethers.JsonRpcProvider(config.evmRpcUrl);
    this.evmSigner = new ethers.Wallet(config.operatorKey, this.evmProvider);
    this.vaultContract = new ethers.Contract(config.vaultAddress, VAULT_ABI, this.evmSigner);
  }

  // ========================================
  // STEP 1: Query policy from Canton DIRECTLY
  // ========================================
  async fetchPolicy(vaultId: string) {
    // Query vault contract
    const vaults = await this.cantonClient.queryContracts(
      this.operatorParty,
      `${PACKAGE_ID}:PolicyControlledVault:PolicyControlledVault`,
      { vaultId }
    );

    if (vaults.length === 0) {
      throw new Error(`Vault ${vaultId} not found`);
    }

    const vault = vaults[0];

    // Query policy contract
    const policies = await this.cantonClient.queryContracts(
      this.operatorParty,
      `${PACKAGE_ID}:Policy:VaultPolicy`,
      {}
    );

    const policy = policies.find(p => p.contractId === vault.payload.policyCid);

    return {
      vault,
      policy: policy?.payload
    };
  }

  // ========================================
  // STEP 2: Fetch current EVM state
  // ========================================
  async fetchEVMState() {
    const [totalAssets, totalSupply, pricePerShare] = await this.vaultContract.getOracleData();
    const positions = await this.vaultContract.getPositions();

    return {
      totalAssets,
      totalSupply,
      pricePerShare,
      positions: positions.map((p: any) => ({
        token: p.token,
        amount: p.amount,
        valueUSD: p.valueUSD
      }))
    };
  }

  // ========================================
  // STEP 3: Calculate rebalance actions
  // ========================================
  calculateActions(policy: any, evmState: any) {
    const actions: any[] = [];
    const targetAllocations = policy.targetAllocations || {};
    const threshold = policy.rebalanceThreshold || 5;
    const totalValue = evmState.totalAssets;

    // Calculate current vs target allocations
    for (const [token, targetPct] of Object.entries(targetAllocations)) {
      const currentPos = evmState.positions.find((p: any) => p.token === token);
      const currentValue = currentPos?.valueUSD || 0n;
      const currentPct = Number((currentValue * 10000n) / totalValue) / 100;
      const drift = Math.abs(currentPct - (targetPct as number));

      if (drift > threshold) {
        const targetValue = (totalValue * BigInt(Math.floor((targetPct as number) * 100))) / 10000n;

        actions.push({
          type: 'swap',
          fromToken: targetValue > currentValue ? 'USDC' : token,
          toToken: targetValue > currentValue ? token : 'USDC',
          amount: targetValue > currentValue
            ? (targetValue - currentValue).toString()
            : (currentValue - targetValue).toString(),
          protocol: policy.allowedProtocols?.[0] || 'uniswap'
        });
      }
    }

    return actions;
  }

  // ========================================
  // STEP 4: Execute on EVM
  // ========================================
  async executeActions(actions: any[]) {
    const txHashes: string[] = [];

    for (const action of actions) {
      console.log(`Swap: ${action.fromToken} -> ${action.toToken} (${action.amount})`);

      const tx = await this.vaultContract.rebalance(
        action.fromToken,
        action.toToken,
        action.amount,
        action.protocol
      );

      const receipt = await tx.wait();
      txHashes.push(receipt.hash);
    }

    return txHashes;
  }

  // ========================================
  // STEP 5: Report back to Canton DIRECTLY
  // ========================================
  async reportToCanton(vaultContractId: string, newState: any) {
    await this.cantonClient.exerciseChoice(
      this.operatorParty,
      vaultContractId,
      `${PACKAGE_ID}:PolicyControlledVault:PolicyControlledVault`,
      'ReportEVMState',
      {
        totalAssets: newState.totalAssets.toString(),
        totalSupply: newState.totalSupply.toString(),
        pricePerShare: newState.pricePerShare.toString(),
        reportTime: new Date().toISOString(),
        reporter: this.operatorParty
      }
    );
  }

  // ========================================
  // MAIN: Run rebalance cycle
  // ========================================
  async rebalance(cantonVaultId: string) {
    console.log(`\n=== Rebalancing ${cantonVaultId} ===\n`);

    // 1. Get policy from Canton (DIRECT)
    const { vault, policy } = await this.fetchPolicy(cantonVaultId);
    console.log('Policy:', policy?.targetAllocations);

    // 2. Get EVM state
    const evmState = await this.fetchEVMState();
    console.log('EVM Assets:', evmState.totalAssets.toString());

    // 3. Calculate actions
    const actions = this.calculateActions(policy, evmState);
    if (actions.length === 0) {
      console.log('No rebalance needed');
      return;
    }

    // 4. Execute on EVM
    const txHashes = await this.executeActions(actions);
    console.log('Executed:', txHashes);

    // 5. Report to Canton (DIRECT)
    const newState = await this.fetchEVMState();
    await this.reportToCanton(vault.contractId, newState);

    console.log('=== Complete ===\n');
  }
}

// Run
const rebalancer = new VaultRebalancer({
  cantonHost: process.env.CANTON_HOST || 'p1-json.cantondefi.com',
  cantonAuthSecret: process.env.CANTON_AUTH_SECRET || 'unsafe',
  operatorParty: process.env.OPERATOR_PARTY!,
  evmRpcUrl: process.env.EVM_RPC_URL!,
  vaultAddress: process.env.EVM_VAULT_ADDRESS!,
  operatorKey: process.env.OPERATOR_PRIVATE_KEY!
});

// Run every hour
setInterval(() => {
  rebalancer.rebalance(process.env.CANTON_VAULT_ID!).catch(console.error);
}, 60 * 60 * 1000);

rebalancer.rebalance(process.env.CANTON_VAULT_ID!);
```

---

## Environment Variables

```env
# Canton (direct connection)
CANTON_HOST=p1-json.cantondefi.com
CANTON_AUTH_SECRET=unsafe
OPERATOR_PARTY=operator::1220abc...

# EVM
EVM_RPC_URL=https://mainnet.infura.io/v3/YOUR_KEY
EVM_VAULT_ADDRESS=0x1234...
OPERATOR_PRIVATE_KEY=0xabc...

# Vault
CANTON_VAULT_ID=VAULT-123
```

---

## Key Point

**The bot does NOT need cloudflare-wallet.** It queries Canton directly using the JSON API, just like cloudflare-wallet's worker functions do. The only difference:

| Component | Uses Canton Via |
|-----------|-----------------|
| Browser UI (stratos-vault) | SDK → postMessage → cloudflare-wallet → Canton |
| Rebalancer Bot | Direct → Canton JSON API |

Both ultimately talk to the same Canton ledger, just through different paths.
