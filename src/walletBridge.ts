/**
 * Wallet Bridge - Handles postMessage communication with embedded apps
 *
 * This module processes requests from apps using the Stratos Wallet SDK
 * and routes them to the appropriate wallet functions.
 */

export interface WalletRequest {
  id: string;
  method: string;
  params?: unknown;
}

export interface WalletResponse {
  id: string;
  result?: unknown;
  error?: {
    code: number;
    message: string;
  };
}

export interface AuthUser {
  id: string;
  username: string;
  displayName: string | null;
  role: 'user' | 'admin';
  partyId?: string;
}

export interface ChainAddress {
  chain: string;
  chainType: 'evm' | 'svm' | 'btc' | 'tron' | 'ton' | 'canton' | 'base';
  address: string;
  icon?: string;
}

export interface Asset {
  id?: string;
  symbol: string;
  name: string;
  balance: number;
  icon: string | null;
  chain?: string;
  chainType?: string;
}

export interface Transaction {
  transactionId: string;
  type: 'send' | 'receive';
  amount: number;
  symbol: string;
  from: string;
  to: string;
  chain: string;
  timestamp: string;
  status: 'pending' | 'confirmed' | 'failed';
}

export interface TransferOffer {
  contractId: string;
  sender: string;
  receiver: string;
  amount: string;
  symbol: string;
  description?: string;
  expiresAt?: string;
}

// Canton Generic Contract Types
export interface CantonContract<T = Record<string, unknown>> {
  contractId: string;
  templateId: string;
  payload: T;
  createdAt?: string;
  signatories?: string[];
  observers?: string[];
}

export interface CantonQueryParams {
  templateId: string;
  filter?: Record<string, unknown>;
}

export interface CantonCreateParams {
  templateId: string;
  payload: Record<string, unknown>;
}

export interface CantonExerciseParams {
  contractId: string;
  templateId: string;
  choice: string;
  argument: Record<string, unknown>;
}

export interface CantonCreateResult {
  contractId: string;
}

export interface CantonExerciseResult<T = unknown> {
  exerciseResult: T;
  events?: CantonContract[];
}

// EVM Transaction Types
export interface EVMTransactionRequest {
  to: string;
  value?: string;
  data?: string;
  gasLimit?: string;
  gasPrice?: string;
  maxFeePerGas?: string;
  maxPriorityFeePerGas?: string;
  nonce?: string | number;
  chainId: number;
}

export interface SignEVMTransactionParams {
  transaction: EVMTransactionRequest;
}

export interface SendEVMTransactionParams {
  transaction: EVMTransactionRequest;
}

export interface SignEVMTransactionResult {
  signedTransaction: string;
  transactionHash: string;
}

export interface SendEVMTransactionResult {
  transactionHash: string;
  status: 'pending' | 'confirmed' | 'failed';
}

export interface EIP712TypedData {
  types: Record<string, Array<{ name: string; type: string }>>;
  primaryType: string;
  domain: {
    name?: string;
    version?: string;
    chainId?: number;
    verifyingContract?: string;
    salt?: string;
  };
  message: Record<string, unknown>;
}

export interface SignTypedDataParams {
  typedData: EIP712TypedData;
}

export interface ConnectionState {
  connected: boolean;
  user: AuthUser | null;
  addresses: ChainAddress[];
}

export interface WalletBridgeCallbacks {
  getUser: () => AuthUser | null;
  getAddresses: () => ChainAddress[];
  getAssets: () => Asset[];
  getTransactions: () => Transaction[];
  getTransferOffers: () => TransferOffer[];
  onTransferRequest: (params: {
    to: string;
    amount: string;
    symbol: string;
    chain: string;
  }) => Promise<{ txId: string; status: string }>;
  onSignMessage: (params: { message: string; chain: string }) => Promise<string>;
  onAcceptOffer: (contractId: string) => Promise<{ txId: string; status: string }>;
  onRefresh: () => Promise<void>;
  // Canton Generic Contract Operations
  onCantonQuery?: (params: CantonQueryParams) => Promise<CantonContract[]>;
  onCantonCreate?: (params: CantonCreateParams) => Promise<CantonCreateResult>;
  onCantonExercise?: (params: CantonExerciseParams) => Promise<CantonExerciseResult>;
  // EVM Transaction Operations
  onSignEVMTransaction?: (params: SignEVMTransactionParams) => Promise<SignEVMTransactionResult>;
  onSendEVMTransaction?: (params: SendEVMTransactionParams) => Promise<SendEVMTransactionResult>;
  onSignTypedData?: (params: SignTypedDataParams) => Promise<string>;
  // Bitcoin Transaction Operations
  onSignBTCTransaction?: (params: {
    utxos?: Array<{ txid: string; vout: number; value: number }>;
    to: string;
    amount: number;
    changeAddress?: string;
    fee?: number;
    network?: 'mainnet' | 'testnet';
  }) => Promise<{ rawTransaction: string; txid: string }>;
  onSendBTCTransaction?: (params: {
    utxos?: Array<{ txid: string; vout: number; value: number }>;
    to: string;
    amount: number;
    changeAddress?: string;
    fee?: number;
    network?: 'mainnet' | 'testnet';
  }) => Promise<{ txid: string; status: string }>;
  // Solana Transaction Operations
  onSignSOLTransaction?: (params: {
    to: string;
    amount: number;
    network?: 'mainnet' | 'devnet';
  }) => Promise<{ rawTransaction: string; signature: string }>;
  onSendSOLTransaction?: (params: {
    to: string;
    amount: number;
    network?: 'mainnet' | 'devnet';
  }) => Promise<{ signature: string; status: string }>;
  // TRON Transaction Operations
  onSignTRONTransaction?: (params: {
    to: string;
    amount: number;
    network?: 'mainnet' | 'shasta';
  }) => Promise<{ rawTransaction: string; txID: string; signature: string }>;
  onSendTRONTransaction?: (params: {
    to: string;
    amount: number;
    network?: 'mainnet' | 'shasta';
  }) => Promise<{ txID: string; status: string }>;
  // TON Transaction Operations
  onSignTONTransaction?: (params: {
    to: string;
    amount: bigint;
    message?: string;
    network?: 'mainnet' | 'testnet';
  }) => Promise<{ boc: string; hash: string }>;
  onSendTONTransaction?: (params: {
    to: string;
    amount: bigint;
    message?: string;
    network?: 'mainnet' | 'testnet';
  }) => Promise<{ hash: string; status: string }>;
}

/**
 * Allowed origins for iframe apps
 * In production, this should be a whitelist of trusted app domains
 */
const ALLOWED_ORIGINS = [
  'http://localhost:3000',
  'http://localhost:3001',
  'http://localhost:3002',
  'http://localhost:5173',
  'http://localhost:5174',
  // Production app origins
  'https://vault.cantondefi.com',
];

export class WalletBridge {
  private callbacks: WalletBridgeCallbacks;
  private allowedOrigins: string[];
  private iframeRefs: Map<string, HTMLIFrameElement> = new Map();

  constructor(callbacks: WalletBridgeCallbacks, allowedOrigins?: string[]) {
    this.callbacks = callbacks;
    this.allowedOrigins = allowedOrigins || ALLOWED_ORIGINS;

    // Listen for messages from iframes
    window.addEventListener('message', this.handleMessage.bind(this));
  }

  /**
   * Register an iframe for communication
   */
  registerIframe(appId: string, iframe: HTMLIFrameElement): void {
    this.iframeRefs.set(appId, iframe);
  }

  /**
   * Unregister an iframe
   */
  unregisterIframe(appId: string): void {
    this.iframeRefs.delete(appId);
  }

  /**
   * Check if origin is allowed
   */
  private isAllowedOrigin(origin: string): boolean {
    // In development, allow localhost
    if (origin.startsWith('http://localhost:')) {
      return true;
    }
    return this.allowedOrigins.includes(origin);
  }

  /**
   * Handle incoming messages from iframes
   */
  private async handleMessage(event: MessageEvent): Promise<void> {
    // Verify origin
    if (!this.isAllowedOrigin(event.origin)) {
      console.warn('[WalletBridge] Rejected message from untrusted origin:', event.origin);
      return;
    }

    const data = event.data as WalletRequest;

    // Validate request format
    if (!data || typeof data.id !== 'string' || typeof data.method !== 'string') {
      return;
    }

    console.log('[WalletBridge] Received request:', data.method, data.params);

    try {
      const result = await this.processRequest(data.method, data.params);
      this.sendResponse(event.source as Window, event.origin, {
        id: data.id,
        result,
      });
    } catch (error) {
      this.sendResponse(event.source as Window, event.origin, {
        id: data.id,
        error: {
          code: -1,
          message: error instanceof Error ? error.message : 'Unknown error',
        },
      });
    }
  }

  /**
   * Process a request and return result
   */
  private async processRequest(method: string, params?: unknown): Promise<unknown> {
    switch (method) {
      case 'connect': {
        const user = this.callbacks.getUser();
        const addresses = this.callbacks.getAddresses();
        return {
          connected: user !== null,
          user,
          addresses,
        } as ConnectionState;
      }

      case 'disconnect':
        return { success: true };

      case 'getUser':
        return this.callbacks.getUser();

      case 'getAddresses':
        return this.callbacks.getAddresses();

      case 'getAddress': {
        const { chain } = params as { chain: string };
        const addresses = this.callbacks.getAddresses();
        const addr = addresses.find(a => a.chainType === chain);
        if (!addr) {
          throw new Error(`No address for chain: ${chain}`);
        }
        return addr.address;
      }

      case 'getAssets':
        return this.callbacks.getAssets();

      case 'getBalance': {
        const { symbol, chain } = params as { symbol: string; chain?: string };
        const assets = this.callbacks.getAssets();
        const asset = assets.find(a => {
          if (chain) {
            return a.symbol === symbol && a.chainType === chain;
          }
          return a.symbol === symbol;
        });
        return asset ? asset.balance : 0;
      }

      case 'getTransactions':
        return this.callbacks.getTransactions();

      case 'transfer': {
        const transferParams = params as {
          to: string;
          amount: string;
          symbol: string;
          chain: string;
        };
        return this.callbacks.onTransferRequest(transferParams);
      }

      case 'signMessage': {
        const signParams = params as { message: string; chain: string };
        return this.callbacks.onSignMessage(signParams);
      }

      case 'getPartyId': {
        const user = this.callbacks.getUser();
        if (!user?.partyId) {
          throw new Error('Not connected to Canton');
        }
        return user.partyId;
      }

      case 'getTransferOffers':
        return this.callbacks.getTransferOffers();

      case 'acceptOffer': {
        const { contractId } = params as { contractId: string };
        return this.callbacks.onAcceptOffer(contractId);
      }

      case 'refresh':
        await this.callbacks.onRefresh();
        return { success: true };

      // Canton Generic Contract Operations
      case 'cantonQuery': {
        if (!this.callbacks.onCantonQuery) {
          throw new Error('Canton query not supported');
        }
        const queryParams = params as CantonQueryParams;
        return this.callbacks.onCantonQuery(queryParams);
      }

      case 'cantonCreate': {
        if (!this.callbacks.onCantonCreate) {
          throw new Error('Canton create not supported');
        }
        const createParams = params as CantonCreateParams;
        return this.callbacks.onCantonCreate(createParams);
      }

      case 'cantonExercise': {
        if (!this.callbacks.onCantonExercise) {
          throw new Error('Canton exercise not supported');
        }
        const exerciseParams = params as CantonExerciseParams;
        return this.callbacks.onCantonExercise(exerciseParams);
      }

      // EVM Transaction Operations
      case 'signEVMTransaction': {
        if (!this.callbacks.onSignEVMTransaction) {
          throw new Error('EVM transaction signing not supported');
        }
        const signTxParams = params as SignEVMTransactionParams;
        return this.callbacks.onSignEVMTransaction(signTxParams);
      }

      case 'sendEVMTransaction': {
        if (!this.callbacks.onSendEVMTransaction) {
          throw new Error('EVM transaction sending not supported');
        }
        const sendTxParams = params as SendEVMTransactionParams;
        return this.callbacks.onSendEVMTransaction(sendTxParams);
      }

      case 'signTypedData': {
        if (!this.callbacks.onSignTypedData) {
          throw new Error('EIP-712 typed data signing not supported');
        }
        const typedDataParams = params as SignTypedDataParams;
        return this.callbacks.onSignTypedData(typedDataParams);
      }

      default:
        throw new Error(`Unknown method: ${method}`);
    }
  }

  /**
   * Send response to iframe
   */
  private sendResponse(target: Window, origin: string, response: WalletResponse): void {
    console.log('[WalletBridge] Sending response:', response);
    target.postMessage(response, origin);
  }

  /**
   * Send event to all registered iframes
   */
  sendEvent(event: string, data: unknown): void {
    const message = {
      type: 'event',
      event,
      data,
    };

    this.iframeRefs.forEach((iframe, appId) => {
      try {
        if (iframe.contentWindow) {
          // Get iframe origin
          const iframeOrigin = new URL(iframe.src).origin;
          iframe.contentWindow.postMessage(message, iframeOrigin);
        }
      } catch (error) {
        console.error(`[WalletBridge] Failed to send event to ${appId}:`, error);
      }
    });
  }

  /**
   * Notify apps of user changes
   */
  notifyUserChanged(): void {
    const user = this.callbacks.getUser();
    this.sendEvent('userChanged', user);
  }

  /**
   * Notify apps of balance changes
   */
  notifyAssetsChanged(): void {
    const assets = this.callbacks.getAssets();
    this.sendEvent('assetsChanged', assets);
  }

  /**
   * Notify apps of address changes
   */
  notifyAddressesChanged(): void {
    const addresses = this.callbacks.getAddresses();
    this.sendEvent('addressesChanged', addresses);
  }

  /**
   * Notify apps of transaction changes
   */
  notifyTransactionsChanged(): void {
    const transactions = this.callbacks.getTransactions();
    this.sendEvent('transactionsChanged', transactions);
  }

  /**
   * Cleanup
   */
  destroy(): void {
    window.removeEventListener('message', this.handleMessage.bind(this));
    this.iframeRefs.clear();
  }
}
