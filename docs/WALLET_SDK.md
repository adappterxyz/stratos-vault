# Stratos Wallet SDK - Integration Guide

## Overview

The Stratos Wallet SDK enables embedded apps (running inside the wallet's dock as iframes) to communicate with the parent wallet via `postMessage`. Apps can query wallet state, request transactions, interact with Canton smart contracts, and react to real-time state changes.

## Quick Start

```typescript
// 1. Send a request to the wallet
function walletRequest(method: string, params?: any): Promise<any> {
  return new Promise((resolve, reject) => {
    const id = crypto.randomUUID();
    const handler = (event: MessageEvent) => {
      if (event.data?.id === id) {
        window.removeEventListener('message', handler);
        if (event.data.error) reject(new Error(event.data.error.message));
        else resolve(event.data.result);
      }
    };
    window.addEventListener('message', handler);
    window.parent.postMessage({ id, method, params }, '*');
  });
}

// 2. Connect and get wallet state
const state = await walletRequest('connect');
console.log(state.connected);  // true
console.log(state.network);    // 'mainnet' or 'testnet'
console.log(state.user);       // { id, username, displayName, role, partyId }
console.log(state.addresses);  // [{ chain, chainType, address }]
```

## Request/Response Protocol

All communication uses the `postMessage` API with a simple request/response pattern.

### Request Format

```typescript
interface WalletRequest {
  id: string;       // Unique request ID (use crypto.randomUUID())
  method: string;   // Method name (e.g., 'connect', 'getNetwork')
  params?: any;     // Method parameters (optional)
}
```

### Response Format

```typescript
interface WalletResponse {
  id: string;       // Matches request ID
  result?: any;     // Success result
  error?: {         // Error (mutually exclusive with result)
    code: number;
    message: string;
  };
}
```

### Event Format

Events are pushed from the wallet to all registered iframes without a request.

```typescript
interface WalletEvent {
  type: 'event';
  event: string;    // Event name (e.g., 'networkChanged')
  data: any;        // Event payload
}
```

## Methods

### Connection

| Method | Params | Returns | Description |
|--------|--------|---------|-------------|
| `connect` | - | `ConnectionState` | Get current wallet state |
| `disconnect` | - | `{ success: true }` | Disconnect (no-op currently) |

#### ConnectionState

```typescript
{
  connected: boolean;
  user: { id, username, displayName, role, partyId } | null;
  addresses: Array<{ chain, chainType, address }>;
  network: 'mainnet' | 'testnet';
}
```

### Wallet State

| Method | Params | Returns | Description |
|--------|--------|---------|-------------|
| `getUser` | - | `AuthUser \| null` | Get authenticated user |
| `getAddresses` | - | `ChainAddress[]` | Get all chain addresses |
| `getAddress` | `{ chain }` | `string` | Get address for specific chain |
| `getNetwork` | - | `'mainnet' \| 'testnet'` | Get current network mode |
| `getAssets` | - | `Asset[]` | Get all assets with balances |
| `getBalance` | `{ symbol, chain? }` | `number` | Get balance for a specific asset |
| `getTransactions` | - | `Transaction[]` | Get recent transactions |
| `getTransferOffers` | - | `TransferOffer[]` | Get pending transfer offers |

### Transactions

| Method | Params | Returns | Description |
|--------|--------|---------|-------------|
| `transfer` | `{ to, amount, symbol, chain }` | `{ txId, status }` | Send a transfer |
| `signMessage` | `{ message, chain }` | `string` | Sign a message |
| `acceptOffer` | `{ contractId }` | `{ txId, status }` | Accept a transfer offer |
| `refresh` | - | `{ success: true }` | Trigger wallet data refresh |

### EVM Operations

| Method | Params | Returns | Description |
|--------|--------|---------|-------------|
| `signEVMTransaction` | `{ transaction }` | `{ signedTransaction, transactionHash }` | Sign an EVM transaction |
| `sendEVMTransaction` | `{ transaction }` | `{ transactionHash, status }` | Sign and broadcast EVM transaction |
| `signTypedData` | `{ typedData }` | `string` | Sign EIP-712 typed data |
| `getTransactionReceipt` | `{ txHash, chainId }` | Receipt object | Get transaction receipt |

### Solana Operations

| Method | Params | Returns | Description |
|--------|--------|---------|-------------|
| `signRawSolanaTransaction` | `{ transaction, network? }` | `{ signedTransaction, signature }` | Sign raw Solana transaction |
| `sendRawSolanaTransaction` | `{ signedTransaction, network? }` | `{ signature, status }` | Broadcast signed Solana transaction |

### TON Operations

| Method | Params | Returns | Description |
|--------|--------|---------|-------------|
| `signRawTonMessage` | `{ to, value, payload?, stateInit?, network? }` | `{ boc, hash }` | Sign TON message |
| `sendRawTonMessage` | `{ boc, network? }` | `{ hash, status }` | Broadcast signed TON message |

### TRON Operations

| Method | Params | Returns | Description |
|--------|--------|---------|-------------|
| `triggerTronSmartContract` | `{ contractAddress, functionSelector, parameter, ... }` | `{ txID, rawTransaction, signature }` | Trigger TRON smart contract |
| `broadcastTronTransaction` | `{ signedTransaction, network? }` | `{ txID, status }` | Broadcast TRON transaction |

### Canton (Daml) Operations

| Method | Params | Returns | Description |
|--------|--------|---------|-------------|
| `getPartyId` | - | `string` | Get user's Canton party ID |
| `cantonQuery` | `{ templateId, filter?, readAs? }` | `CantonContract[]` | Query active contracts |
| `cantonCreate` | `{ templateId, payload, actAs? }` | `{ contractId }` | Create a contract |
| `cantonExercise` | `{ contractId, templateId, choice, argument, actAs? }` | `{ exerciseResult, events? }` | Exercise a choice |
| `grantUserRights` | `{ userId, rights }` | `{ success, userId, grantedRights }` | Grant Canton user rights |

### Chat Agent

| Method | Params | Returns | Description |
|--------|--------|---------|-------------|
| `chatAgent` | `{ message, sessionId?, name? }` | `{ reply, sessionId, conversationId }` | Send message to AI chat agent |

## Events

The wallet pushes events to all registered iframes when state changes. Listen for them with `window.addEventListener('message', ...)`.

| Event | Data | Description |
|-------|------|-------------|
| `networkChanged` | `'mainnet' \| 'testnet'` | User toggled network mode |
| `userChanged` | `AuthUser \| null` | User logged in/out or switched account |
| `assetsChanged` | `Asset[]` | Asset list or balances updated |
| `addressesChanged` | `ChainAddress[]` | Chain addresses changed |
| `transactionsChanged` | `Transaction[]` | Transaction list updated |

### Listening for Events

```typescript
window.addEventListener('message', (event) => {
  const msg = event.data;
  if (msg.type !== 'event') return;

  switch (msg.event) {
    case 'networkChanged':
      // msg.data = 'mainnet' | 'testnet'
      switchToNetwork(msg.data);
      break;

    case 'userChanged':
      // msg.data = { id, username, ... } | null
      if (msg.data) onLogin(msg.data);
      else onLogout();
      break;

    case 'assetsChanged':
      // msg.data = [{ symbol, name, balance, chains, ... }]
      updateBalances(msg.data);
      break;
  }
});
```

## Network Awareness

The wallet supports mainnet and testnet modes. When the user toggles the network, the wallet:

1. Switches RPC endpoints to the corresponding network
2. Loads the correct token contract addresses (e.g., Circle testnet USDC)
3. Re-fetches all balances
4. Fires a `networkChanged` event to all embedded apps

### Recommended Integration Pattern

```typescript
let currentNetwork: 'mainnet' | 'testnet' = 'mainnet';

// Get initial network on connect
const state = await walletRequest('connect');
currentNetwork = state.network;
initializeForNetwork(currentNetwork);

// React to network changes
window.addEventListener('message', (event) => {
  if (event.data?.type === 'event' && event.data.event === 'networkChanged') {
    currentNetwork = event.data.data;
    // Switch your RPC endpoints, contract addresses, etc.
    initializeForNetwork(currentNetwork);
  }
});

function initializeForNetwork(network: 'mainnet' | 'testnet') {
  if (network === 'testnet') {
    // Use testnet RPC URLs and contract addresses
  } else {
    // Use mainnet RPC URLs and contract addresses
  }
}
```

## Full Integration Example

```typescript
// wallet-sdk.ts - Minimal SDK wrapper for embedded apps

class WalletSDK {
  private pending = new Map<string, { resolve: Function; reject: Function }>();
  private eventHandlers = new Map<string, Function[]>();
  public network: 'mainnet' | 'testnet' = 'mainnet';

  constructor() {
    window.addEventListener('message', (event) => {
      const msg = event.data;

      // Handle responses
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id)!;
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message));
        else resolve(msg.result);
      }

      // Handle events
      if (msg.type === 'event') {
        if (msg.event === 'networkChanged') this.network = msg.data;
        this.eventHandlers.get(msg.event)?.forEach(fn => fn(msg.data));
      }
    });
  }

  request(method: string, params?: any): Promise<any> {
    return new Promise((resolve, reject) => {
      const id = crypto.randomUUID();
      this.pending.set(id, { resolve, reject });
      window.parent.postMessage({ id, method, params }, '*');
    });
  }

  on(event: string, handler: Function) {
    if (!this.eventHandlers.has(event)) this.eventHandlers.set(event, []);
    this.eventHandlers.get(event)!.push(handler);
  }

  async connect() {
    const state = await this.request('connect');
    this.network = state.network;
    return state;
  }

  getNetwork() { return this.request('getNetwork'); }
  getAssets() { return this.request('getAssets'); }
  getBalance(symbol: string) { return this.request('getBalance', { symbol }); }
  transfer(params: any) { return this.request('transfer', params); }
}

// Usage
const sdk = new WalletSDK();
const state = await sdk.connect();
sdk.on('networkChanged', (network: string) => console.log('Network:', network));
```
