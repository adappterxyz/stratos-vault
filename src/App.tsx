import { useState, useEffect, useRef, useCallback } from 'react';
import { base64URLStringToBuffer, bufferToBase64URLString } from '@simplewebauthn/browser';
import { Html5Qrcode } from 'html5-qrcode';
import { generateWalletsForChains, WalletData, decryptPrivateKey } from './crypto';
import { WalletBridge } from './walletBridge';
import * as evmSigner from './evmSigner';
import * as btcSigner from './btcSigner';
import * as solSigner from './solSigner';
import * as tronSigner from './tronSigner';
import * as tonSigner from './tonSigner';
import Wallet from './components/Wallet';
import './App.css';

// PRF salt - consistent for all users
const PRF_SALT = new TextEncoder().encode('canton-wallet-encryption-v1');

interface WalletBalance {
  total: number;
  contracts: number;
}

interface AssetChain {
  chain: string;
  chainType: string;
  contractAddress: string | null;
  decimals: number;
}

interface Asset {
  id?: string;  // For custom assets
  symbol: string;
  name: string;
  balance: number;
  icon?: string;
  chain?: string;
  chainType?: string;
  chains?: AssetChain[];  // All chains this asset is available on
  isCustom?: boolean;  // True for user-added custom assets
}

interface AssetConfig {
  symbol: string;
  name: string;
  icon: string | null;
  chain: string;
  chainType: string | null;
  contractAddress?: string | null;
  decimals: number;
  isNative: boolean;
  chains?: AssetChain[];  // All chains this asset is available on
}

interface ChainAddress {
  chain: string;
  address: string;
  icon?: string;
}

interface Transaction {
  transactionId: string;
  timestamp: string;
  type: 'send' | 'receive';
  amount: number;
  from: string;
  to: string;
}

interface WalletAddress {
  chainType: string;
  address: string;
}

interface CustomAsset {
  id: string;
  symbol: string;
  name: string;
  icon: string | null;
  chain: string;
  chainType: string;
  contractAddress: string | null;
  decimals: number;
  isCustom?: boolean;
}

interface WalletInfo {
  partyId: string;
  cantonHost: string;
  cantonPort: string;
  applicationId: string;
  onboarded?: boolean;
  walletInstalled?: boolean;
  theme?: string;
  orgName?: string;
  walletAddresses?: WalletAddress[];
}

interface TransferOffer {
  contract_id: string;
  payload: {
    sender: string;
    receiver: string;
    amount: { amount: string; unit: string };
    trackingId: string;
    expiresAt: string;
    description: string;
  };
}

interface CantonUser {
  username: string;
  displayName: string;
  partyId?: string;
}

interface AuthUser {
  id: string;
  username: string;
  displayName: string;
  partyId: string | null;
  role: string;
}

interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
}

interface DbUser {
  id: string;
  username: string;
  display_name: string;
  party_id: string | null;
  role: string;
  created_at: string;
}

const API_BASE = window.location.origin;

function App() {
  // Path-based view detection
  const [currentView, setCurrentView] = useState<'wallet' | 'admin'>(() => {
    return window.location.pathname === '/admin' ? 'admin' : 'wallet';
  });

  // Auth state
  const [sessionId, setSessionId] = useState<string | null>(() => {
    return localStorage.getItem('sessionId');
  });
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);

  // Canton users (for admin view)
  const [cantonUsers, setCantonUsers] = useState<CantonUser[]>([]);

  // Wallet state
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [, setWalletInfo] = useState<WalletInfo | null>(null);
  const [transferOffers, setTransferOffers] = useState<TransferOffer[]>([]);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [loading, setLoading] = useState(true);

  // Transfer form (used by QR scanner)
  const [transferTo, setTransferTo] = useState('');

  // Create party modal
  const [showCreateUser, setShowCreateUser] = useState(false);
  const [newUsername, setNewUsername] = useState('');
  const [newDisplayName, setNewDisplayName] = useState('');
  const [createUserStatus, setCreateUserStatus] = useState('');

  // UI state
  const [showQrScanner, setShowQrScanner] = useState(false);
  const qrScannerRef = useRef<Html5Qrcode | null>(null);

  // Chain addresses (derived from wallet info)
  const [chainAddresses, setChainAddresses] = useState<ChainAddress[]>([]);

  // Custom assets
  const [showAddAssetModal, setShowAddAssetModal] = useState(false);
  const [newAsset, setNewAsset] = useState({
    symbol: '',
    name: '',
    chain: 'Ethereum',
    chainType: 'evm',
    contractAddress: '',
    decimals: 18
  });
  const [addAssetError, setAddAssetError] = useState('');

  // Dock state
  const [dockVisible, setDockVisible] = useState(false);
  const [activeApp, setActiveApp] = useState<string | null>(null);
  const [hoveredApp, setHoveredApp] = useState<string | null>(null);
  // Track which apps have active sessions (opened but not closed)
  const [openAppSessions, setOpenAppSessions] = useState<Set<string>>(new Set());

  // Dock apps configuration - loaded from API
  const [dockApps, setDockApps] = useState<Array<{ id: string; name: string; icon: string; color: string; url: string | null }>>([]);
  const [allowedIframeOrigins, setAllowedIframeOrigins] = useState<string[]>([]);

  // Wallet Bridge for iframe communication
  const walletBridgeRef = useRef<WalletBridge | null>(null);
  const iframeRefs = useRef<Map<string, HTMLIFrameElement>>(new Map());

  // AI Chat state
  const [chatOpen, setChatOpen] = useState(false);
  const [chatMessages, setChatMessages] = useState<{ role: 'user' | 'assistant'; content: string }[]>([
    { role: 'assistant', content: 'Hello! I\'m your AI assistant. How can I help you with your wallet today?' }
  ]);
  const [chatInput, setChatInput] = useState('');

  const handleSendChat = (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim()) return;

    // Add user message
    setChatMessages(prev => [...prev, { role: 'user', content: chatInput }]);

    // Simulate AI response
    setTimeout(() => {
      setChatMessages(prev => [...prev, {
        role: 'assistant',
        content: 'This is a demo AI assistant. In a real implementation, I would help you with wallet operations, answer questions about your assets, and provide guidance on transactions.'
      }]);
    }, 1000);

    setChatInput('');
  };

  // Login form
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [loginUsername, setLoginUsername] = useState('');
  const [loginError, setLoginError] = useState('');
  const [authLoading, setAuthLoading] = useState(false);

  // Admin panel state
  const [dbUsers, setDbUsers] = useState<DbUser[]>([]);
  const [adminLoading, setAdminLoading] = useState(false);
  const [adminError, setAdminError] = useState('');
  const [nodeName, setNodeName] = useState<string | null>(null);
  const [partiesExpanded, setPartiesExpanded] = useState(false);
  const [partiesLoading, setPartiesLoading] = useState(false);
  const [usersExpanded, setUsersExpanded] = useState(true); // User management expanded by default
  const [adminToken, setAdminToken] = useState<string | null>(() => localStorage.getItem('adminToken'));
  const [adminPassword, setAdminPassword] = useState('');

  // Registration codes state
  const [registrationCodes, setRegistrationCodes] = useState<{
    id: string;
    code: string;
    maxUses: number;
    usesRemaining: number;
    totalUses: number;
    createdBy: string | null;
    expiresAt: string | null;
    createdAt: string;
    isExpired: boolean;
    isDepleted: boolean;
  }[]>([]);
  const [regCodesExpanded, setRegCodesExpanded] = useState(false);
  const [regCodesLoading, setRegCodesLoading] = useState(false);
  const [showCreateCode, setShowCreateCode] = useState(false);
  const [newCodeMaxUses, setNewCodeMaxUses] = useState('10');
  const [newCodeExpiry, setNewCodeExpiry] = useState('');
  const [createCodeStatus, setCreateCodeStatus] = useState('');

  // Registration code validation (for login page)
  const [registrationCode] = useState<string>(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get('code') || '';
  });
  const [codeValidation, setCodeValidation] = useState<{
    valid: boolean;
    reason?: string;
    usesRemaining?: number;
    checked: boolean;
  }>({ valid: false, checked: false });

  // Theme and org state
  const [theme, setTheme] = useState<string>('purple');
  const [orgName, setOrgName] = useState<string>('Canton Wallet');

  // DAR upload state
  const [darExpanded, setDarExpanded] = useState(false);
  const [darUploading, setDarUploading] = useState(false);
  const [darUploadStatus, setDarUploadStatus] = useState('');
  const [packageIds, setPackageIds] = useState<string[]>([]);
  const [packagesLoading, setPackagesLoading] = useState(false);


  // Handle browser back/forward navigation
  useEffect(() => {
    const handlePopState = () => {
      setCurrentView(window.location.pathname === '/admin' ? 'admin' : 'wallet');
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  // Fetch theme, org name, dock apps on mount (before authentication)
  useEffect(() => {
    const fetchConfig = async () => {
      try {
        const res = await fetch(`${API_BASE}/api/config`);
        const data = await res.json() as ApiResponse<{
          theme: string;
          orgName: string;
          dockApps: Array<{ id: string; name: string; icon: string; color: string; url: string | null }>;
          allowedIframeOrigins: string[];
        }>;
        if (data.success && data.data) {
          if (data.data.theme) setTheme(data.data.theme);
          if (data.data.orgName) {
            setOrgName(data.data.orgName);
            document.title = data.data.orgName;
          }
          if (data.data.dockApps && data.data.dockApps.length > 0) {
            setDockApps(data.data.dockApps);
          }
          if (data.data.allowedIframeOrigins) {
            setAllowedIframeOrigins(data.data.allowedIframeOrigins);
          }
        }
      } catch (error) {
        console.error('Failed to fetch config:', error);
      }
    };
    fetchConfig();
  }, []);

  // Check session on mount
  useEffect(() => {
    if (sessionId) {
      checkSession();
    } else {
      setLoading(false);
    }
  }, []);

  // Load wallet data when authenticated
  useEffect(() => {
    if (authUser) {
      loadWalletData();
    }
  }, [authUser]);

  // Initialize wallet bridge for iframe communication
  const getUser = useCallback(() => {
    if (!authUser) return null;
    return {
      id: authUser.id,
      username: authUser.username,
      displayName: authUser.displayName || null,
      role: authUser.role as 'user' | 'admin',
      partyId: authUser.partyId || undefined,
    };
  }, [authUser]);

  const getAddresses = useCallback(() => {
    return chainAddresses.map(addr => ({
      chain: addr.chain,
      chainType: (addr.chain.toLowerCase() === 'ethereum' ? 'evm'
        : addr.chain.toLowerCase() === 'solana' ? 'svm'
        : addr.chain.toLowerCase() === 'bitcoin' ? 'btc'
        : addr.chain.toLowerCase()) as 'evm' | 'svm' | 'btc' | 'tron' | 'ton' | 'canton' | 'base',
      address: addr.address,
    }));
  }, [chainAddresses]);

  const getAssets = useCallback(() => {
    return assets.map(a => ({
      id: a.symbol,
      symbol: a.symbol,
      name: a.name,
      balance: a.balance,
      icon: a.icon || null,
      chain: a.chain || '',
      chainType: a.chainType || '',
    }));
  }, [assets]);

  const getTransactions = useCallback(() => {
    return transactions.map(tx => ({
      transactionId: tx.transactionId,
      type: tx.type as 'send' | 'receive',
      amount: tx.amount,
      symbol: 'CC', // Default to Canton Coin
      from: tx.from,
      to: tx.to,
      chain: 'canton',
      timestamp: tx.timestamp,
      status: 'confirmed' as 'pending' | 'confirmed' | 'failed',
    }));
  }, [transactions]);

  const getTransferOffers = useCallback(() => {
    return transferOffers.map(offer => ({
      contractId: offer.contract_id,
      sender: offer.payload.sender,
      receiver: offer.payload.receiver,
      amount: offer.payload.amount.amount,
      symbol: offer.payload.amount.unit || 'CC',
      description: offer.payload.description,
      expiresAt: offer.payload.expiresAt,
    }));
  }, [transferOffers]);

  useEffect(() => {
    if (!authUser) return;

    // Create wallet bridge instance
    walletBridgeRef.current = new WalletBridge({
      getUser,
      getAddresses,
      getAssets,
      getTransactions,
      getTransferOffers,
      onTransferRequest: async (params: { to: string; amount: string; symbol: string; chain: string }) => {
        // This will be called when an iframe app requests a transfer
        const response = await fetch(`${API_BASE}/api/wallet/transfer`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Wallet-User': authUser.username,
            'Authorization': `Bearer ${sessionId}`
          },
          body: JSON.stringify({
            to: params.to,
            amount: parseFloat(params.amount)
          })
        });
        const data = await response.json() as ApiResponse<{ transactionId: string; status?: string }>;
        if (data.success && data.data) {
          loadWalletData();
          return { txId: data.data.transactionId, status: data.data.status || 'confirmed' };
        }
        throw new Error(data.error || 'Transfer failed');
      },
      onAcceptOffer: async (contractId: string) => {
        const response = await fetch(`${API_BASE}/api/wallet/transfer-offers/${contractId}/accept`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Wallet-User': authUser.username,
            'Authorization': `Bearer ${sessionId}`
          }
        });
        const data = await response.json() as ApiResponse<{ transactionId: string }>;
        if (data.success && data.data) {
          loadWalletData();
          return { txId: data.data.transactionId, status: 'confirmed' };
        }
        throw new Error(data.error || 'Accept offer failed');
      },
      onRefresh: async () => {
        await loadWalletData();
      },
      // Canton Generic Contract Operations
      onCantonQuery: async (params: { templateId: string; filter?: Record<string, unknown> }) => {
        const response = await fetch(`${API_BASE}/api/canton/query`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${sessionId}`
          },
          body: JSON.stringify(params)
        });
        const data = await response.json() as ApiResponse<any[]>;
        if (data.success && data.data) {
          return data.data;
        }
        throw new Error(data.error || 'Query failed');
      },
      onCantonCreate: async (params: { templateId: string; payload: Record<string, unknown> }) => {
        const response = await fetch(`${API_BASE}/api/canton/create`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${sessionId}`
          },
          body: JSON.stringify(params)
        });
        const data = await response.json() as ApiResponse<{ contractId: string }>;
        if (data.success && data.data) {
          return data.data;
        }
        throw new Error(data.error || 'Create failed');
      },
      onCantonExercise: async (params: { contractId: string; templateId: string; choice: string; argument: Record<string, unknown> }) => {
        const response = await fetch(`${API_BASE}/api/canton/exercise`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${sessionId}`
          },
          body: JSON.stringify(params)
        });
        const data = await response.json() as ApiResponse<{ exerciseResult: unknown; events?: any[] }>;
        if (data.success && data.data) {
          return data.data;
        }
        throw new Error(data.error || 'Exercise failed');
      },
      // EVM Transaction Operations - Client-side signing with PRF
      onSignEVMTransaction: async (params: { transaction: { to: string; value?: string; data?: string; chainId: number } }) => {
        // Get EVM address from chainAddresses
        const evmAddr = chainAddresses.find(a => a.chain === 'Ethereum');
        if (!evmAddr) {
          throw new Error('No EVM wallet found');
        }

        // Request passkey authentication to get PRF output
        const prfOutput = await requestPrfAuthentication();
        if (!prfOutput) {
          throw new Error('Passkey authentication required for signing');
        }

        // Get encrypted private key from backend
        const keyRes = await fetch(`${API_BASE}/api/wallet/private-key?chainType=evm`, {
          headers: { 'Authorization': `Bearer ${sessionId}` }
        });
        const keyData = await keyRes.json() as ApiResponse<{ encryptedKey: string }>;
        if (!keyData.success || !keyData.data) {
          throw new Error('Failed to get encrypted key');
        }

        // Decrypt private key using PRF output
        const privateKey = await decryptPrivateKey(prfOutput, keyData.data.encryptedKey);

        // Sign transaction
        const signed = await evmSigner.signTransaction(
          params.transaction,
          privateKey,
          evmAddr.address
        );

        return {
          signedTransaction: signed.rawTransaction,
          transactionHash: signed.transactionHash
        };
      },
      onSendEVMTransaction: async (params: { transaction: { to: string; value?: string; data?: string; chainId: number } }) => {
        // Get EVM address from chainAddresses
        const evmAddr = chainAddresses.find(a => a.chain === 'Ethereum');
        if (!evmAddr) {
          throw new Error('No EVM wallet found');
        }

        // Request passkey authentication to get PRF output
        const prfOutput = await requestPrfAuthentication();
        if (!prfOutput) {
          throw new Error('Passkey authentication required for signing');
        }

        // Get encrypted private key from backend
        const keyRes = await fetch(`${API_BASE}/api/wallet/private-key?chainType=evm`, {
          headers: { 'Authorization': `Bearer ${sessionId}` }
        });
        const keyData = await keyRes.json() as ApiResponse<{ encryptedKey: string }>;
        if (!keyData.success || !keyData.data) {
          throw new Error('Failed to get encrypted key');
        }

        // Decrypt private key using PRF output
        const privateKey = await decryptPrivateKey(prfOutput, keyData.data.encryptedKey);

        // Sign and send transaction
        const result = await evmSigner.signAndSendTransaction(
          params.transaction,
          privateKey,
          evmAddr.address
        );

        return {
          transactionHash: result.transactionHash,
          status: result.status as 'pending' | 'confirmed' | 'failed'
        };
      },
      onSignTypedData: async (params: { typedData: { types: any; primaryType: string; domain: any; message: any } }) => {
        // Get EVM address from chainAddresses
        const evmAddr = chainAddresses.find(a => a.chain === 'Ethereum');
        if (!evmAddr) {
          throw new Error('No EVM wallet found');
        }

        // Request passkey authentication to get PRF output
        const prfOutput = await requestPrfAuthentication();
        if (!prfOutput) {
          throw new Error('Passkey authentication required for signing');
        }

        // Get encrypted private key from backend
        const keyRes = await fetch(`${API_BASE}/api/wallet/private-key?chainType=evm`, {
          headers: { 'Authorization': `Bearer ${sessionId}` }
        });
        const keyData = await keyRes.json() as ApiResponse<{ encryptedKey: string }>;
        if (!keyData.success || !keyData.data) {
          throw new Error('Failed to get encrypted key');
        }

        // Decrypt private key using PRF output
        const privateKey = await decryptPrivateKey(prfOutput, keyData.data.encryptedKey);

        // Sign typed data
        return evmSigner.signTypedData(params.typedData, privateKey);
      },
      // Bitcoin Transaction Operations
      onSignBTCTransaction: async (params: { to: string; amount: number; fee?: number; network?: 'mainnet' | 'testnet' }) => {
        const btcAddr = chainAddresses.find(a => a.chain === 'Bitcoin');
        if (!btcAddr) {
          throw new Error('No Bitcoin wallet found');
        }

        const prfOutput = await requestPrfAuthentication();
        if (!prfOutput) {
          throw new Error('Passkey authentication required for signing');
        }

        const keyRes = await fetch(`${API_BASE}/api/wallet/private-key?chainType=btc`, {
          headers: { 'Authorization': `Bearer ${sessionId}` }
        });
        const keyData = await keyRes.json() as ApiResponse<{ encryptedKey: string }>;
        if (!keyData.success || !keyData.data) {
          throw new Error('Failed to get encrypted key');
        }

        const privateKey = await decryptPrivateKey(prfOutput, keyData.data.encryptedKey);
        const network = params.network || 'mainnet';

        // Get UTXOs for the address
        const utxos = await btcSigner.getUTXOs(btcAddr.address, network);
        if (utxos.length === 0) {
          throw new Error('No UTXOs available');
        }

        const signed = await btcSigner.signTransaction(
          utxos,
          params.to,
          params.amount,
          privateKey,
          btcAddr.address,
          params.fee || 1000,
          network
        );

        return {
          rawTransaction: signed.rawTransaction,
          txid: signed.txid
        };
      },
      onSendBTCTransaction: async (params: { to: string; amount: number; fee?: number; network?: 'mainnet' | 'testnet' }) => {
        const btcAddr = chainAddresses.find(a => a.chain === 'Bitcoin');
        if (!btcAddr) {
          throw new Error('No Bitcoin wallet found');
        }

        const prfOutput = await requestPrfAuthentication();
        if (!prfOutput) {
          throw new Error('Passkey authentication required for signing');
        }

        const keyRes = await fetch(`${API_BASE}/api/wallet/private-key?chainType=btc`, {
          headers: { 'Authorization': `Bearer ${sessionId}` }
        });
        const keyData = await keyRes.json() as ApiResponse<{ encryptedKey: string }>;
        if (!keyData.success || !keyData.data) {
          throw new Error('Failed to get encrypted key');
        }

        const privateKey = await decryptPrivateKey(prfOutput, keyData.data.encryptedKey);
        const network = params.network || 'mainnet';

        const utxos = await btcSigner.getUTXOs(btcAddr.address, network);
        if (utxos.length === 0) {
          throw new Error('No UTXOs available');
        }

        const result = await btcSigner.signAndSendTransaction(
          utxos,
          params.to,
          params.amount,
          privateKey,
          btcAddr.address,
          params.fee || 1000,
          network
        );

        return {
          txid: result.txid,
          status: result.status
        };
      },
      // Solana Transaction Operations
      onSignSOLTransaction: async (params: { to: string; amount: number; network?: 'mainnet' | 'devnet' }) => {
        const solAddr = chainAddresses.find(a => a.chain === 'Solana');
        if (!solAddr) {
          throw new Error('No Solana wallet found');
        }

        const prfOutput = await requestPrfAuthentication();
        if (!prfOutput) {
          throw new Error('Passkey authentication required for signing');
        }

        const keyRes = await fetch(`${API_BASE}/api/wallet/private-key?chainType=svm`, {
          headers: { 'Authorization': `Bearer ${sessionId}` }
        });
        const keyData = await keyRes.json() as ApiResponse<{ encryptedKey: string }>;
        if (!keyData.success || !keyData.data) {
          throw new Error('Failed to get encrypted key');
        }

        const privateKey = await decryptPrivateKey(prfOutput, keyData.data.encryptedKey);
        const network = params.network || 'mainnet';

        const signed = await solSigner.signTransaction(
          params.to,
          params.amount,
          privateKey,
          network
        );

        return {
          rawTransaction: signed.rawTransaction,
          signature: signed.signature
        };
      },
      onSendSOLTransaction: async (params: { to: string; amount: number; network?: 'mainnet' | 'devnet' }) => {
        const solAddr = chainAddresses.find(a => a.chain === 'Solana');
        if (!solAddr) {
          throw new Error('No Solana wallet found');
        }

        const prfOutput = await requestPrfAuthentication();
        if (!prfOutput) {
          throw new Error('Passkey authentication required for signing');
        }

        const keyRes = await fetch(`${API_BASE}/api/wallet/private-key?chainType=svm`, {
          headers: { 'Authorization': `Bearer ${sessionId}` }
        });
        const keyData = await keyRes.json() as ApiResponse<{ encryptedKey: string }>;
        if (!keyData.success || !keyData.data) {
          throw new Error('Failed to get encrypted key');
        }

        const privateKey = await decryptPrivateKey(prfOutput, keyData.data.encryptedKey);
        const network = params.network || 'mainnet';

        const result = await solSigner.signAndSendTransaction(
          params.to,
          params.amount,
          privateKey,
          network
        );

        return {
          signature: result.signature,
          status: result.status
        };
      },
      // TRON Transaction Operations
      onSignTRONTransaction: async (params: { to: string; amount: number; network?: 'mainnet' | 'shasta' }) => {
        const tronAddr = chainAddresses.find(a => a.chain === 'TRON');
        if (!tronAddr) {
          throw new Error('No TRON wallet found');
        }

        const prfOutput = await requestPrfAuthentication();
        if (!prfOutput) {
          throw new Error('Passkey authentication required for signing');
        }

        const keyRes = await fetch(`${API_BASE}/api/wallet/private-key?chainType=tron`, {
          headers: { 'Authorization': `Bearer ${sessionId}` }
        });
        const keyData = await keyRes.json() as ApiResponse<{ encryptedKey: string }>;
        if (!keyData.success || !keyData.data) {
          throw new Error('Failed to get encrypted key');
        }

        const privateKey = await decryptPrivateKey(prfOutput, keyData.data.encryptedKey);
        const network = params.network || 'mainnet';

        const signed = await tronSigner.signTransaction(
          params.to,
          params.amount,
          privateKey,
          network
        );

        return {
          rawTransaction: signed.rawTransaction,
          txID: signed.txID,
          signature: signed.signature
        };
      },
      onSendTRONTransaction: async (params: { to: string; amount: number; network?: 'mainnet' | 'shasta' }) => {
        const tronAddr = chainAddresses.find(a => a.chain === 'TRON');
        if (!tronAddr) {
          throw new Error('No TRON wallet found');
        }

        const prfOutput = await requestPrfAuthentication();
        if (!prfOutput) {
          throw new Error('Passkey authentication required for signing');
        }

        const keyRes = await fetch(`${API_BASE}/api/wallet/private-key?chainType=tron`, {
          headers: { 'Authorization': `Bearer ${sessionId}` }
        });
        const keyData = await keyRes.json() as ApiResponse<{ encryptedKey: string }>;
        if (!keyData.success || !keyData.data) {
          throw new Error('Failed to get encrypted key');
        }

        const privateKey = await decryptPrivateKey(prfOutput, keyData.data.encryptedKey);
        const network = params.network || 'mainnet';

        const result = await tronSigner.signAndSendTransaction(
          params.to,
          params.amount,
          privateKey,
          network
        );

        return {
          txID: result.txID,
          status: result.status
        };
      },
      // TON Transaction Operations
      onSignTONTransaction: async (params: { to: string; amount: bigint; message?: string; network?: 'mainnet' | 'testnet' }) => {
        const tonAddr = chainAddresses.find(a => a.chain === 'TON');
        if (!tonAddr) {
          throw new Error('No TON wallet found');
        }

        const prfOutput = await requestPrfAuthentication();
        if (!prfOutput) {
          throw new Error('Passkey authentication required for signing');
        }

        const keyRes = await fetch(`${API_BASE}/api/wallet/private-key?chainType=ton`, {
          headers: { 'Authorization': `Bearer ${sessionId}` }
        });
        const keyData = await keyRes.json() as ApiResponse<{ encryptedKey: string }>;
        if (!keyData.success || !keyData.data) {
          throw new Error('Failed to get encrypted key');
        }

        const privateKey = await decryptPrivateKey(prfOutput, keyData.data.encryptedKey);
        const network = params.network || 'mainnet';

        const signed = await tonSigner.signTransaction(
          params.to,
          params.amount,
          privateKey,
          params.message,
          network
        );

        return {
          boc: signed.boc,
          hash: signed.hash
        };
      },
      onSendTONTransaction: async (params: { to: string; amount: bigint; message?: string; network?: 'mainnet' | 'testnet' }) => {
        const tonAddr = chainAddresses.find(a => a.chain === 'TON');
        if (!tonAddr) {
          throw new Error('No TON wallet found');
        }

        const prfOutput = await requestPrfAuthentication();
        if (!prfOutput) {
          throw new Error('Passkey authentication required for signing');
        }

        const keyRes = await fetch(`${API_BASE}/api/wallet/private-key?chainType=ton`, {
          headers: { 'Authorization': `Bearer ${sessionId}` }
        });
        const keyData = await keyRes.json() as ApiResponse<{ encryptedKey: string }>;
        if (!keyData.success || !keyData.data) {
          throw new Error('Failed to get encrypted key');
        }

        const privateKey = await decryptPrivateKey(prfOutput, keyData.data.encryptedKey);
        const network = params.network || 'mainnet';

        const result = await tonSigner.signAndSendTransaction(
          params.to,
          params.amount,
          privateKey,
          params.message,
          network
        );

        return {
          hash: result.hash,
          status: result.status
        };
      },
      // Generic message signing for all chains
      onSignMessage: async (params: { message: string; chain: string }) => {
        const prfOutput = await requestPrfAuthentication();
        if (!prfOutput) {
          throw new Error('Passkey authentication required for signing');
        }

        let chainType: string;
        switch (params.chain.toLowerCase()) {
          case 'ethereum':
          case 'base':
          case 'evm':
            chainType = 'evm';
            break;
          case 'bitcoin':
          case 'btc':
            chainType = 'btc';
            break;
          case 'solana':
          case 'sol':
          case 'svm':
            chainType = 'svm';
            break;
          case 'tron':
          case 'trx':
            chainType = 'tron';
            break;
          case 'ton':
            chainType = 'ton';
            break;
          default:
            throw new Error(`Unsupported chain: ${params.chain}`);
        }

        const keyRes = await fetch(`${API_BASE}/api/wallet/private-key?chainType=${chainType}`, {
          headers: { 'Authorization': `Bearer ${sessionId}` }
        });
        const keyData = await keyRes.json() as ApiResponse<{ encryptedKey: string }>;
        if (!keyData.success || !keyData.data) {
          throw new Error('Failed to get encrypted key');
        }

        const privateKey = await decryptPrivateKey(prfOutput, keyData.data.encryptedKey);

        switch (chainType) {
          case 'evm':
            return evmSigner.signMessage(params.message, privateKey);
          case 'svm':
            return solSigner.signMessage(params.message, privateKey);
          case 'tron':
            return tronSigner.signMessage(params.message, privateKey);
          case 'ton':
            return tonSigner.signMessage(params.message, privateKey);
          default:
            throw new Error(`Message signing not supported for ${params.chain}`);
        }
      },
    }, allowedIframeOrigins.length > 0 ? allowedIframeOrigins : undefined);

    return () => {
      walletBridgeRef.current?.destroy();
      walletBridgeRef.current = null;
    };
  }, [authUser, sessionId, getUser, getAddresses, getAssets, getTransactions, getTransferOffers, allowedIframeOrigins]);

  // Register iframe when app opens
  const registerAppIframe = useCallback((appId: string, iframe: HTMLIFrameElement | null) => {
    if (iframe) {
      iframeRefs.current.set(appId, iframe);
      walletBridgeRef.current?.registerIframe(appId, iframe);
    } else {
      iframeRefs.current.delete(appId);
      walletBridgeRef.current?.unregisterIframe(appId);
    }
  }, []);

  const checkSession = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/auth/session`, {
        headers: { 'Authorization': `Bearer ${sessionId}` }
      });
      const data = await res.json() as ApiResponse<{ user: AuthUser }>;

      if (data.success && data.data) {
        setAuthUser(data.data.user);
      } else {
        // Invalid session
        localStorage.removeItem('sessionId');
        setSessionId(null);
      }
    } catch (error) {
      console.error('Session check failed:', error);
      localStorage.removeItem('sessionId');
      setSessionId(null);
    } finally {
      setLoading(false);
    }
  };

  // Request PRF authentication for signing operations
  const requestPrfAuthentication = async (): Promise<ArrayBuffer | null> => {
    try {
      // Get PRF auth options from server
      const optionsRes = await fetch(`${API_BASE}/api/auth/passkey/prf-options`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${sessionId}`
        }
      });
      const optionsData = await optionsRes.json() as ApiResponse<{ options: any }>;

      if (!optionsData.success || !optionsData.data) {
        throw new Error(optionsData.error || 'Failed to get PRF options');
      }

      const options = optionsData.data.options;

      // Convert options for native WebAuthn API with PRF extension
      const publicKeyOptions: PublicKeyCredentialRequestOptions = {
        challenge: base64URLStringToBuffer(options.challenge),
        timeout: options.timeout,
        rpId: options.rpId,
        allowCredentials: (options.allowCredentials || []).map((cred: any) => ({
          id: base64URLStringToBuffer(cred.id),
          type: cred.type,
          transports: cred.transports
        })),
        userVerification: options.userVerification || 'required',
        extensions: {
          prf: {
            eval: {
              first: PRF_SALT
            }
          }
        } as any
      };

      // Start WebAuthn authentication with PRF
      const credential = await navigator.credentials.get({
        publicKey: publicKeyOptions
      }) as PublicKeyCredential;

      if (!credential) {
        throw new Error('Authentication failed');
      }

      // Get PRF output
      const clientExtResults = credential.getClientExtensionResults() as any;
      const prfOutput = clientExtResults?.prf?.results?.first;

      if (!prfOutput) {
        throw new Error('PRF output not available. Your passkey may not support encryption.');
      }

      return prfOutput;
    } catch (error) {
      console.error('PRF authentication error:', error);
      return null;
    }
  };

  const handlePasskeyRegister = async () => {
    if (!loginUsername.trim()) {
      setLoginError('Please enter a username');
      return;
    }

    if (!registrationCode || !codeValidation.valid) {
      setLoginError('A valid registration code is required');
      return;
    }

    setAuthLoading(true);
    setLoginError('');

    try {
      // Get registration options
      const optionsRes = await fetch(`${API_BASE}/api/auth/passkey/register-options`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: loginUsername.trim(),
          registrationCode: registrationCode.toUpperCase()
        })
      });
      const optionsData = await optionsRes.json() as ApiResponse<{ options: any; userId: string }>;

      if (!optionsData.success || !optionsData.data) {
        throw new Error(optionsData.error || 'Failed to get registration options');
      }

      const options = optionsData.data.options;

      // Convert options for native WebAuthn API with PRF extension
      const publicKeyOptions: PublicKeyCredentialCreationOptions = {
        challenge: base64URLStringToBuffer(options.challenge),
        rp: options.rp,
        user: {
          id: base64URLStringToBuffer(options.user.id),
          name: options.user.name,
          displayName: options.user.displayName
        },
        pubKeyCredParams: options.pubKeyCredParams,
        timeout: options.timeout,
        attestation: options.attestation || 'none',
        authenticatorSelection: options.authenticatorSelection,
        excludeCredentials: (options.excludeCredentials || []).map((cred: any) => ({
          id: base64URLStringToBuffer(cred.id),
          type: cred.type,
          transports: cred.transports
        })),
        extensions: {
          // Enable PRF extension for passkey-derived encryption
          prf: {
            eval: {
              first: PRF_SALT
            }
          }
        } as any
      };

      // Start WebAuthn registration with PRF
      const credential = await navigator.credentials.create({
        publicKey: publicKeyOptions
      }) as PublicKeyCredential;

      if (!credential) {
        throw new Error('Failed to create credential');
      }

      const response = credential.response as AuthenticatorAttestationResponse;

      // Check for PRF support
      const clientExtResults = credential.getClientExtensionResults() as any;
      const prfEnabled = clientExtResults?.prf?.enabled;
      let walletAddresses: WalletData[] = [];

      if (prfEnabled) {
        // PRF is supported - we need to do a second operation to get PRF output
        // For registration, we just note that PRF is enabled
        // Wallets will be generated on first login when we can get PRF output
        console.log('PRF extension enabled for this credential');
      } else {
        console.warn('PRF not supported by authenticator - wallets will be generated server-side');
      }

      // Format credential for verification
      const credentialJSON = {
        id: credential.id,
        rawId: bufferToBase64URLString(credential.rawId),
        type: credential.type,
        response: {
          clientDataJSON: bufferToBase64URLString(response.clientDataJSON),
          attestationObject: bufferToBase64URLString(response.attestationObject),
          transports: response.getTransports?.() || []
        },
        clientExtensionResults: {
          prf: prfEnabled ? { enabled: true } : undefined
        }
      };

      // Verify registration
      const verifyRes = await fetch(`${API_BASE}/api/auth/passkey/register-verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: optionsData.data.userId,
          response: credentialJSON,
          prfEnabled,
          walletAddresses: walletAddresses.length > 0 ? walletAddresses : undefined
        })
      });
      const verifyData = await verifyRes.json() as ApiResponse<{ sessionId: string; user: AuthUser }>;

      if (!verifyData.success || !verifyData.data) {
        throw new Error(verifyData.error || 'Registration failed');
      }

      // Save session
      localStorage.setItem('sessionId', verifyData.data.sessionId);
      setSessionId(verifyData.data.sessionId);
      setAuthUser(verifyData.data.user);

      setLoginUsername('');
    } catch (error: any) {
      console.error('Registration error:', error);
      setLoginError(error.message || 'Registration failed');
    } finally {
      setAuthLoading(false);
    }
  };

  const handlePasskeyLogin = async () => {
    setAuthLoading(true);
    setLoginError('');

    try {
      // Get authentication options
      const optionsRes = await fetch(`${API_BASE}/api/auth/passkey/login-options`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: loginUsername.trim() || undefined })
      });
      const optionsData = await optionsRes.json() as ApiResponse<{
        options: any;
        needsWallets?: boolean;
        missingChainTypes?: string[];
      }>;

      if (!optionsData.success || !optionsData.data) {
        throw new Error(optionsData.error || 'Failed to get login options');
      }

      const options = optionsData.data.options;
      const missingChainTypes = optionsData.data.missingChainTypes || [];

      // Convert options for native WebAuthn API with PRF extension
      const publicKeyOptions: PublicKeyCredentialRequestOptions = {
        challenge: base64URLStringToBuffer(options.challenge),
        timeout: options.timeout,
        rpId: options.rpId,
        allowCredentials: (options.allowCredentials || []).map((cred: any) => ({
          id: base64URLStringToBuffer(cred.id),
          type: cred.type,
          transports: cred.transports
        })),
        userVerification: options.userVerification || 'preferred',
        extensions: {
          // Request PRF output for wallet encryption/decryption
          prf: {
            eval: {
              first: PRF_SALT
            }
          }
        } as any
      };

      // Start WebAuthn authentication with PRF
      const credential = await navigator.credentials.get({
        publicKey: publicKeyOptions
      }) as PublicKeyCredential;

      if (!credential) {
        throw new Error('Authentication failed');
      }

      const response = credential.response as AuthenticatorAssertionResponse;

      // Get PRF output for wallet encryption
      const clientExtResults = credential.getClientExtensionResults() as any;
      const prfOutput = clientExtResults?.prf?.results?.first;
      let walletAddresses: WalletData[] = [];

      console.log('[Login Debug] PRF output available:', !!prfOutput);
      console.log('[Login Debug] Missing chain types:', missingChainTypes);

      // If PRF is available and user has missing chain wallets, generate them client-side
      if (prfOutput && missingChainTypes.length > 0) {
        console.log(`[Login Debug] Generating wallets for missing chains: ${missingChainTypes.join(', ')}`);
        walletAddresses = await generateWalletsForChains(
          prfOutput,
          missingChainTypes as Array<'evm' | 'svm' | 'btc' | 'tron' | 'ton'>
        );
        console.log('[Login Debug] Generated wallet addresses:', walletAddresses.map(w => ({ chainType: w.chainType, address: w.address })));
      } else if (!prfOutput) {
        console.warn('[Login Debug] PRF output not available - cannot generate wallets client-side');
      } else if (missingChainTypes.length === 0) {
        console.log('[Login Debug] No missing chain types - all wallets exist');
      }

      // Format credential for verification
      const credentialJSON = {
        id: credential.id,
        rawId: bufferToBase64URLString(credential.rawId),
        type: credential.type,
        response: {
          clientDataJSON: bufferToBase64URLString(response.clientDataJSON),
          authenticatorData: bufferToBase64URLString(response.authenticatorData),
          signature: bufferToBase64URLString(response.signature),
          userHandle: response.userHandle ? bufferToBase64URLString(response.userHandle) : undefined
        },
        clientExtensionResults: {
          prf: prfOutput ? { hasOutput: true } : undefined
        }
      };

      // Verify authentication
      const verifyRes = await fetch(`${API_BASE}/api/auth/passkey/login-verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          response: credentialJSON,
          walletAddresses: walletAddresses.length > 0 ? walletAddresses : undefined
        })
      });
      const verifyData = await verifyRes.json() as ApiResponse<{ sessionId: string; user: AuthUser }>;

      if (!verifyData.success || !verifyData.data) {
        throw new Error(verifyData.error || 'Login failed');
      }

      // Save session
      localStorage.setItem('sessionId', verifyData.data.sessionId);
      setSessionId(verifyData.data.sessionId);
      setAuthUser(verifyData.data.user);

      setLoginUsername('');
    } catch (error: any) {
      console.error('Login error:', error);
      setLoginError(error.message || 'Login failed');
    } finally {
      setAuthLoading(false);
    }
  };

  const handleLogout = async () => {
    try {
      await fetch(`${API_BASE}/api/auth/session`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${sessionId}` }
      });
    } catch (error) {
      console.error('Logout error:', error);
    }

    localStorage.removeItem('sessionId');
    setSessionId(null);
    setAuthUser(null);
    setAssets([]);
    setTransactions([]);
    setWalletInfo(null);
  };

  // Fetch canton users (for admin view) - only when dropdown is expanded
  const fetchCantonUsers = async () => {
    if (!adminToken) return;
    if (cantonUsers.length > 0) return; // Already loaded
    setPartiesLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/auth/users`, {
        headers: { 'X-Admin-Token': adminToken }
      });
      const data = await res.json() as ApiResponse<CantonUser[]>;
      if (data.success && data.data) {
        setCantonUsers(data.data);
      }
    } catch (error) {
      console.error('Error fetching canton users:', error);
    } finally {
      setPartiesLoading(false);
    }
  };

  // Toggle Canton Parties dropdown and fetch if needed
  const togglePartiesDropdown = () => {
    const newExpanded = !partiesExpanded;
    setPartiesExpanded(newExpanded);
    if (newExpanded && cantonUsers.length === 0) {
      fetchCantonUsers();
    }
  };

  // Fetch balances from blockchain RPCs (native tokens and contract tokens)
  const fetchChainBalances = async (
    walletAddresses: Array<{ chainType: string; address: string }>,
    assetsList: Asset[]
  ) => {
    const balances: Record<string, number> = {};

    // Fetch native token balances
    const nativeBalancePromises = walletAddresses.map(async (wallet) => {
      try {
        switch (wallet.chainType) {
          case 'evm': {
            // Fetch ETH balance (mainnet)
            const ethBalance = await evmSigner.getBalance(wallet.address, 1);
            balances['ETH'] = Number(ethBalance) / 1e18;
            // Fetch Base ETH balance
            const baseBalance = await evmSigner.getBalance(wallet.address, 8453);
            balances['BASE_ETH'] = Number(baseBalance) / 1e18;
            break;
          }
          case 'btc': {
            const btcBalance = await btcSigner.getBalance(wallet.address, 'mainnet');
            balances['BTC'] = btcBalance / 1e8; // satoshis to BTC
            break;
          }
          case 'svm': {
            const solBalance = await solSigner.getBalance(wallet.address, 'mainnet');
            balances['SOL'] = solBalance / 1e9; // lamports to SOL
            break;
          }
          case 'tron': {
            const trxBalance = await tronSigner.getBalance(wallet.address, 'mainnet');
            balances['TRX'] = trxBalance / 1e6; // SUN to TRX
            break;
          }
          case 'ton': {
            const tonBalance = await tonSigner.getBalance(wallet.address, 'mainnet');
            balances['TON'] = Number(tonBalance) / 1e9; // nanotons to TON
            break;
          }
        }
      } catch (err) {
        console.error(`Failed to fetch ${wallet.chainType} balance:`, err);
      }
    });

    await Promise.all(nativeBalancePromises);

    // Fetch ERC20/token balances for assets with contract addresses
    const tokenBalancePromises: Promise<void>[] = [];

    for (const asset of assetsList) {
      if (!asset.chains) continue;

      for (const chain of asset.chains) {
        if (!chain.contractAddress) continue; // Skip native tokens

        const wallet = walletAddresses.find(w => w.chainType === chain.chainType);
        if (!wallet) continue;

        // Create a unique key for this asset+chain combination
        const balanceKey = asset.chains.length > 1
          ? `${asset.symbol}_${chain.chain}`
          : asset.symbol;

        tokenBalancePromises.push((async () => {
          try {
            const decimals = chain.decimals || 18;
            let tokenBalance = 0n;

            if (chain.chainType === 'evm') {
              // ERC20 token balance
              const chainId = chain.chain === 'Base' ? 8453 : 1;
              tokenBalance = await evmSigner.getTokenBalance(
                chain.contractAddress!,
                wallet.address,
                chainId
              );
            } else if (chain.chainType === 'svm') {
              // SPL token balance (Solana)
              tokenBalance = await solSigner.getTokenBalance(
                chain.contractAddress!,
                wallet.address,
                'mainnet'
              );
            } else if (chain.chainType === 'tron') {
              // TRC20 token balance (Tron)
              tokenBalance = await tronSigner.getTokenBalance(
                chain.contractAddress!,
                wallet.address,
                'mainnet'
              );
            }

            balances[balanceKey] = Number(tokenBalance) / Math.pow(10, decimals);
          } catch (err) {
            console.error(`Failed to fetch ${asset.symbol} balance on ${chain.chain}:`, err);
          }
        })());
      }
    }

    await Promise.all(tokenBalancePromises);
    return balances;
  };

  const loadWalletData = async () => {
    if (!authUser) return;

    try {
      setLoading(true);

      const headers = {
        'X-Wallet-User': authUser.username,
        'Authorization': `Bearer ${sessionId}`
      };

      const [balanceRes, txRes, infoRes, offersRes, assetsRes, customAssetsRes] = await Promise.all([
        fetch(`${API_BASE}/api/wallet/balance`, { headers }),
        fetch(`${API_BASE}/api/wallet/transactions`, { headers }),
        fetch(`${API_BASE}/api/wallet/info`, { headers }),
        fetch(`${API_BASE}/api/wallet/transfer-offers`, { headers }),
        fetch(`${API_BASE}/api/assets`),
        fetch(`${API_BASE}/api/wallet/custom-assets`, { headers })
      ]);

      const balanceData = await balanceRes.json() as ApiResponse<WalletBalance>;
      const txData = await txRes.json() as ApiResponse<Transaction[]>;
      const infoData = await infoRes.json() as ApiResponse<WalletInfo>;
      const assetsConfigData = await assetsRes.json() as ApiResponse<AssetConfig[]>;
      const customAssetsData = await customAssetsRes.json() as ApiResponse<CustomAsset[]>;

      // Build assets list from config with balances
      const ccBalance = balanceData.success && balanceData.data ? balanceData.data.total : 0;

      // Build base assets list from config
      let assetsList: Asset[] = [];
      if (assetsConfigData.success && assetsConfigData.data && assetsConfigData.data.length > 0) {
        assetsList = assetsConfigData.data.map(config => ({
          symbol: config.symbol,
          name: config.name,
          balance: config.symbol === 'CC' ? ccBalance : 0,
          icon: config.icon || '●',
          chain: config.chain,
          chainType: config.chainType || undefined,
          chains: config.chains  // Multi-chain support
        }));
      } else {
        // Fallback to hardcoded assets if database is empty
        assetsList = [
          { symbol: 'CC', name: 'Canton Coin', balance: ccBalance, icon: '◈', chain: 'Canton', chainType: 'canton' },
          { symbol: 'ETH', name: 'Ethereum', balance: 0, icon: 'Ξ', chain: 'Ethereum', chainType: 'evm' },
          { symbol: 'BTC', name: 'Bitcoin', balance: 0, icon: '₿', chain: 'Bitcoin', chainType: 'btc' },
          { symbol: 'SOL', name: 'Solana', balance: 0, icon: '◎', chain: 'Solana', chainType: 'svm' },
          { symbol: 'USDC', name: 'USD Coin', balance: 0, icon: '$', chain: 'Ethereum', chainType: 'evm' },
          { symbol: 'USDT', name: 'Tether', balance: 0, icon: '₮', chain: 'Ethereum', chainType: 'evm' },
          { symbol: 'TRX', name: 'Tron', balance: 0, icon: '⟁', chain: 'Tron', chainType: 'tron' },
        ];
      }

      // Add custom assets to the list
      if (customAssetsData.success && customAssetsData.data) {
        const customAssetsList: Asset[] = customAssetsData.data.map(ca => ({
          id: ca.id,
          symbol: ca.symbol,
          name: ca.name,
          balance: 0,
          icon: ca.icon || '●',
          chain: ca.chain,
          chainType: ca.chainType,
          chains: [{ chain: ca.chain, chainType: ca.chainType, contractAddress: ca.contractAddress, decimals: ca.decimals }],
          isCustom: true
        }));
        assetsList = [...assetsList, ...customAssetsList];
      }

      setAssets(assetsList);

      if (txData.success && txData.data) {
        setTransactions(txData.data);
      } else {
        setTransactions([]);
      }

      if (infoData.success && infoData.data) {
        setWalletInfo(infoData.data);
        // Set theme from wallet info
        if (infoData.data.theme) {
          setTheme(infoData.data.theme);
        }
        // Set chain addresses from wallet info
        const addresses: ChainAddress[] = [
          { chain: 'Canton', address: infoData.data.partyId, icon: '◈' },
        ];

        // Add EVM, SVM, BTC, TRON, and TON addresses from wallet info
        if (infoData.data.walletAddresses) {
          for (const wallet of infoData.data.walletAddresses) {
            if (wallet.chainType === 'evm') {
              addresses.push({ chain: 'Ethereum', address: wallet.address, icon: 'Ξ' });
              // Base uses the same EVM address
              addresses.push({ chain: 'Base', address: wallet.address, icon: '🔵' });
            } else if (wallet.chainType === 'svm') {
              addresses.push({ chain: 'Solana', address: wallet.address, icon: '◎' });
            } else if (wallet.chainType === 'btc') {
              addresses.push({ chain: 'Bitcoin', address: wallet.address, icon: '₿' });
            } else if (wallet.chainType === 'tron') {
              addresses.push({ chain: 'Tron', address: wallet.address, icon: '⟁' });
            } else if (wallet.chainType === 'ton') {
              addresses.push({ chain: 'TON', address: wallet.address, icon: '💎' });
            }
          }
        }

        setChainAddresses(addresses);

        // Fetch real balances from blockchain RPCs
        if (infoData.data.walletAddresses && infoData.data.walletAddresses.length > 0) {
          const chainBalances = await fetchChainBalances(infoData.data.walletAddresses, assetsList);

          // Update asset balances with RPC data
          setAssets(prevAssets => prevAssets.map(asset => {
            let newBalance = asset.balance;

            // Check for multi-chain token balances (e.g., USDC_Ethereum, USDC_Base)
            if (asset.chains && asset.chains.length > 1) {
              // Sum up balances across all chains for multi-chain assets
              let totalBalance = 0;
              for (const chain of asset.chains) {
                const chainKey = `${asset.symbol}_${chain.chain}`;
                if (chainBalances[chainKey] !== undefined) {
                  totalBalance += chainBalances[chainKey];
                }
              }
              // Also check for native balance key
              if (chainBalances[asset.symbol] !== undefined) {
                totalBalance += chainBalances[asset.symbol];
              }
              if (totalBalance > 0) {
                newBalance = totalBalance;
              }
            } else {
              // Single-chain asset - check direct symbol match
              if (chainBalances[asset.symbol] !== undefined) {
                newBalance = chainBalances[asset.symbol];
              }
            }

            return { ...asset, balance: newBalance };
          }));
        }
      }

      const offersData = await offersRes.json() as ApiResponse<{ offers: TransferOffer[] }>;
      if (offersData.success && offersData.data?.offers && offersData.data.offers.length > 0) {
        // Auto-accept all incoming Canton Coin transfer offers
        const offers = offersData.data.offers;
        for (const offer of offers) {
          try {
            await fetch(`${API_BASE}/api/wallet/transfer-offers/${offer.contract_id}/accept`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'X-Wallet-User': authUser.username,
                'Authorization': `Bearer ${sessionId}`
              }
            });
            console.log(`Auto-accepted transfer offer: ${offer.contract_id}`);
          } catch (err) {
            console.error(`Failed to auto-accept offer ${offer.contract_id}:`, err);
          }
        }
        // Clear offers after auto-accepting (they're now processed)
        setTransferOffers([]);
        // Reload balance and transactions after auto-accepting
        const [newBalanceRes, newTxRes] = await Promise.all([
          fetch(`${API_BASE}/api/wallet/balance`, { headers }),
          fetch(`${API_BASE}/api/wallet/transactions`, { headers })
        ]);
        const newBalanceData = await newBalanceRes.json() as ApiResponse<WalletBalance>;
        const newTxData = await newTxRes.json() as ApiResponse<Transaction[]>;
        if (newBalanceData.success && newBalanceData.data) {
          // Update CC balance in assets
          setAssets(prev => prev.map(a =>
            a.symbol === 'CC' ? { ...a, balance: newBalanceData.data!.total } : a
          ));
        }
        if (newTxData.success && newTxData.data) {
          setTransactions(newTxData.data);
        }
      } else {
        setTransferOffers([]);
      }
    } catch (error) {
      console.error('Error loading wallet data:', error);
      setAssets([{ symbol: 'CC', name: 'Canton Coin', balance: 0, icon: '◈', chain: 'Canton' }]);
      setTransactions([]);
      setTransferOffers([]);
      setChainAddresses([]);
    } finally {
      setLoading(false);
    }
  };

  const handleAcceptOffer = async (contractId: string) => {
    if (!authUser) return;

    try {
      const response = await fetch(`${API_BASE}/api/wallet/transfer-offers/${contractId}/accept`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Wallet-User': authUser.username,
          'Authorization': `Bearer ${sessionId}`
        }
      });

      const data = await response.json() as ApiResponse;
      if (data.success) {
        loadWalletData();
      } else {
        console.error('Error accepting offer:', data.error);
      }
    } catch (error) {
      console.error('Error accepting offer:', error);
    }
  };

  // Chain options for custom asset dropdown
  const chainOptions = [
    { chain: 'Ethereum', chainType: 'evm' },
    { chain: 'Base', chainType: 'base' },
    { chain: 'Solana', chainType: 'svm' },
    { chain: 'Bitcoin', chainType: 'btc' },
    { chain: 'Tron', chainType: 'tron' },
    { chain: 'TON', chainType: 'ton' },
    { chain: 'Canton', chainType: 'canton' }
  ];

  const handleAddCustomAsset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!authUser || !sessionId) return;

    setAddAssetError('');

    if (!newAsset.symbol.trim() || !newAsset.name.trim()) {
      setAddAssetError('Symbol and name are required');
      return;
    }

    try {
      const response = await fetch(`${API_BASE}/api/wallet/custom-assets`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${sessionId}`
        },
        body: JSON.stringify(newAsset)
      });

      const data = await response.json() as ApiResponse<CustomAsset>;
      if (data.success) {
        setShowAddAssetModal(false);
        setNewAsset({
          symbol: '',
          name: '',
          chain: 'Ethereum',
          chainType: 'evm',
          contractAddress: '',
          decimals: 18
        });
        loadWalletData();
      } else {
        setAddAssetError(data.error || 'Failed to add asset');
      }
    } catch (error) {
      setAddAssetError('Failed to add asset');
    }
  };

  const handleDeleteCustomAsset = async (assetId: string) => {
    if (!authUser || !sessionId) return;

    if (!confirm('Are you sure you want to delete this custom asset?')) return;

    try {
      const response = await fetch(`${API_BASE}/api/wallet/custom-assets?id=${assetId}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${sessionId}`
        }
      });

      const data = await response.json() as ApiResponse;
      if (data.success) {
        loadWalletData();
      }
    } catch (error) {
      console.error('Failed to delete custom asset:', error);
    }
  };

  const handleCreateParty = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!adminToken) return;
    setCreateUserStatus('Creating party...');

    try {
      const response = await fetch(`${API_BASE}/api/admin/users`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Admin-Token': adminToken
        },
        body: JSON.stringify({
          username: newUsername,
          displayName: newDisplayName || newUsername
        })
      });

      const data = await response.json() as ApiResponse<{ username: string; partyId: string }>;

      if (data.success && data.data) {
        setCreateUserStatus(`Success! Party created: ${data.data.partyId}`);
        setNewUsername('');
        setNewDisplayName('');

        setTimeout(() => {
          setShowCreateUser(false);
          setCreateUserStatus('');
        }, 2000);
      } else {
        setCreateUserStatus(`Error: ${data.error}`);
      }
    } catch (error) {
      setCreateUserStatus(`Error: ${error}`);
    }
  };

  const startQrScanner = async () => {
    setShowQrScanner(true);
    setTimeout(async () => {
      try {
        const html5QrCode = new Html5Qrcode('qr-reader');
        qrScannerRef.current = html5QrCode;
        await html5QrCode.start(
          { facingMode: 'environment' },
          { fps: 10, qrbox: { width: 200, height: 200 } },
          (decodedText) => {
            setTransferTo(decodedText);
            stopQrScanner();
          },
          () => {}
        );
      } catch (err) {
        console.error('QR Scanner error:', err);
        stopQrScanner();
      }
    }, 100);
  };

  const stopQrScanner = async () => {
    if (qrScannerRef.current) {
      try {
        await qrScannerRef.current.stop();
        qrScannerRef.current = null;
      } catch (err) {
        console.error('Error stopping scanner:', err);
      }
    }
    setShowQrScanner(false);
  };

  // Navigation helpers
  const navigateTo = (view: 'wallet' | 'admin') => {
    const path = view === 'admin' ? '/admin' : '/';
    window.history.pushState({}, '', path);
    setCurrentView(view);
  };

  // Admin functions (require admin token)
  const fetchDbUsers = async () => {
    if (!adminToken) return;
    setAdminLoading(true);
    setAdminError('');
    try {
      const res = await fetch(`${API_BASE}/api/admin/db-users`, {
        headers: { 'X-Admin-Token': adminToken }
      });
      const data = await res.json() as ApiResponse<DbUser[]> & { nodeName?: string };
      if (data.success && data.data) {
        setDbUsers(data.data);
        if (data.nodeName) {
          setNodeName(data.nodeName);
        }
      } else {
        setAdminError(data.error || 'Failed to fetch users');
      }
    } catch (error) {
      setAdminError('Failed to fetch users');
      console.error('Error fetching db users:', error);
    } finally {
      setAdminLoading(false);
    }
  };

  const handleUpdateUserRole = async (userId: string, newRole: string) => {
    if (!adminToken) return;
    try {
      const res = await fetch(`${API_BASE}/api/admin/db-users/${userId}/role`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'X-Admin-Token': adminToken
        },
        body: JSON.stringify({ role: newRole })
      });
      const data = await res.json() as ApiResponse;
      if (data.success) {
        await fetchDbUsers();
      } else {
        setAdminError(data.error || 'Failed to update role');
      }
    } catch (error) {
      setAdminError('Failed to update role');
      console.error('Error updating role:', error);
    }
  };

  const handleDeleteUser = async (userId: string) => {
    if (!adminToken) return;
    if (!confirm('Are you sure you want to delete this user? This action cannot be undone.')) {
      return;
    }
    try {
      const res = await fetch(`${API_BASE}/api/admin/db-users/${userId}`, {
        method: 'DELETE',
        headers: { 'X-Admin-Token': adminToken }
      });
      const data = await res.json() as ApiResponse;
      if (data.success) {
        await fetchDbUsers();
      } else {
        setAdminError(data.error || 'Failed to delete user');
      }
    } catch (error) {
      setAdminError('Failed to delete user');
      console.error('Error deleting user:', error);
    }
  };

  const handleAdminTapFaucet = async (username: string) => {
    if (!adminToken) return;
    setAdminError('');
    try {
      const res = await fetch(`${API_BASE}/api/wallet/tap`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Wallet-User': username,
          'X-Admin-Token': adminToken
        },
        body: JSON.stringify({ amount: '100.0' })
      });
      const data = await res.json() as ApiResponse;
      if (data.success) {
        setAdminError(`Faucet tapped! 100 CC added to ${username}`);
        setTimeout(() => setAdminError(''), 3000);
      } else {
        setAdminError(`Faucet error: ${data.error}`);
      }
    } catch (error) {
      setAdminError(`Faucet error: ${error}`);
      console.error('Error tapping faucet:', error);
    }
  };

  // Registration codes functions
  const fetchRegistrationCodes = async () => {
    if (!adminToken) return;
    setRegCodesLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/admin/registration-codes`, {
        headers: { 'X-Admin-Token': adminToken }
      });
      const data = await res.json() as ApiResponse<typeof registrationCodes>;
      if (data.success && data.data) {
        setRegistrationCodes(data.data);
      }
    } catch (error) {
      console.error('Error fetching registration codes:', error);
    } finally {
      setRegCodesLoading(false);
    }
  };

  const handleCreateCode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!adminToken) return;
    setCreateCodeStatus('');
    try {
      const res = await fetch(`${API_BASE}/api/admin/registration-codes`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Admin-Token': adminToken
        },
        body: JSON.stringify({
          maxUses: parseInt(newCodeMaxUses) || 10,
          expiresAt: newCodeExpiry || undefined
        })
      });
      const data = await res.json() as ApiResponse<{ code: string }>;
      if (data.success && data.data) {
        setCreateCodeStatus(`Created code: ${data.data.code}`);
        setNewCodeMaxUses('10');
        setNewCodeExpiry('');
        fetchRegistrationCodes();
      } else {
        setCreateCodeStatus(`Error: ${data.error}`);
      }
    } catch (error) {
      setCreateCodeStatus(`Error: ${error}`);
    }
  };

  const handleDeleteCode = async (codeId: string) => {
    if (!adminToken || !confirm('Delete this registration code?')) return;
    try {
      const res = await fetch(`${API_BASE}/api/admin/registration-codes/${codeId}`, {
        method: 'DELETE',
        headers: { 'X-Admin-Token': adminToken }
      });
      const data = await res.json() as ApiResponse;
      if (data.success) {
        fetchRegistrationCodes();
      } else {
        setAdminError(data.error || 'Failed to delete code');
      }
    } catch (error) {
      setAdminError('Failed to delete code');
    }
  };

  const toggleRegCodesDropdown = () => {
    if (!regCodesExpanded && registrationCodes.length === 0) {
      fetchRegistrationCodes();
    }
    setRegCodesExpanded(!regCodesExpanded);
  };

  const copyCodeUrl = (code: string) => {
    const url = `${window.location.origin}?code=${code}`;
    navigator.clipboard.writeText(url);
    setAdminError('Registration URL copied to clipboard!');
    setTimeout(() => setAdminError(''), 2000);
  };

  // DAR upload functions
  const fetchPackages = async () => {
    if (!adminToken) return;
    setPackagesLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/admin/dar`, {
        headers: { 'X-Admin-Token': adminToken }
      });
      const data = await res.json() as ApiResponse<{ packageIds: string[] }>;
      if (data.success && data.data) {
        setPackageIds(data.data.packageIds);
      }
    } catch (error) {
      console.error('Error fetching packages:', error);
    } finally {
      setPackagesLoading(false);
    }
  };

  const toggleDarDropdown = () => {
    if (!darExpanded && packageIds.length === 0) {
      fetchPackages();
    }
    setDarExpanded(!darExpanded);
  };

  const handleDarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!adminToken || !e.target.files || e.target.files.length === 0) return;

    const file = e.target.files[0];
    if (!file.name.endsWith('.dar')) {
      setDarUploadStatus('Error: File must be a .dar file');
      return;
    }

    setDarUploading(true);
    setDarUploadStatus('Uploading...');

    try {
      const formData = new FormData();
      formData.append('dar', file);

      const res = await fetch(`${API_BASE}/api/admin/dar`, {
        method: 'POST',
        headers: { 'X-Admin-Token': adminToken },
        body: formData
      });

      const data = await res.json() as ApiResponse<{ mainPackageId: string; darName: string; size: number }>;
      if (data.success && data.data) {
        setDarUploadStatus(`Uploaded: ${data.data.darName} (Package: ${data.data.mainPackageId.substring(0, 16)}...)`);
        fetchPackages(); // Refresh package list
      } else {
        setDarUploadStatus(`Error: ${data.error}`);
      }
    } catch (error) {
      setDarUploadStatus(`Error: ${error instanceof Error ? error.message : 'Upload failed'}`);
    } finally {
      setDarUploading(false);
      // Reset the file input
      e.target.value = '';
    }
  };

  // Validate registration code on mount
  useEffect(() => {
    const validateCode = async () => {
      const code = registrationCode;
      if (!code) {
        setCodeValidation({ valid: false, reason: 'no_code', checked: true });
        return;
      }
      try {
        const res = await fetch(`${API_BASE}/api/auth/validate-code?code=${encodeURIComponent(code)}`);
        const data = await res.json() as ApiResponse<{ valid: boolean; reason?: string; usesRemaining?: number }>;
        if (data.success && data.data) {
          setCodeValidation({ ...data.data, checked: true });
        } else {
          setCodeValidation({ valid: false, reason: 'error', checked: true });
        }
      } catch (error) {
        setCodeValidation({ valid: false, reason: 'error', checked: true });
      }
    };
    validateCode();
  }, [registrationCode]);

  // Admin login handler
  const handleAdminLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setAdminLoading(true);
    setAdminError('');

    try {
      const res = await fetch(`${API_BASE}/api/admin/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: adminPassword })
      });
      const data = await res.json() as ApiResponse<{ token: string }>;

      if (data.success && data.data?.token) {
        localStorage.setItem('adminToken', data.data.token);
        setAdminToken(data.data.token);
        setAdminPassword('');
        fetchDbUsers();
      } else {
        setAdminError(data.error || 'Login failed');
      }
    } catch (error) {
      setAdminError('Login failed');
      console.error('Admin login error:', error);
    } finally {
      setAdminLoading(false);
    }
  };

  // Admin logout handler
  const handleAdminLogout = () => {
    localStorage.removeItem('adminToken');
    setAdminToken(null);
    setDbUsers([]);
    setCantonUsers([]);
  };

  // Load admin data when entering admin view and authenticated
  useEffect(() => {
    if (currentView === 'admin' && adminToken) {
      fetchDbUsers();
      // Don't fetch canton users here - load on dropdown click instead
    }
  }, [currentView, adminToken]);

  // Admin view - requires admin password
  if (currentView === 'admin') {
    // Show admin login if not authenticated
    if (!adminToken) {
      return (
        <div className={`app theme-${theme}`}>
          <div className="login-container">
            <div className="login-card">
              <h1>Admin Login</h1>
              <p className="login-subtitle">Enter admin password to continue</p>

              {adminError && (
                <div className="login-error">{adminError}</div>
              )}

              <form onSubmit={handleAdminLogin}>
                <div className="form-group">
                  <label>Password</label>
                  <input
                    type="password"
                    value={adminPassword}
                    onChange={(e) => setAdminPassword(e.target.value)}
                    placeholder="Enter admin password"
                    required
                  />
                </div>

                <button type="submit" className="send-btn" disabled={adminLoading}>
                  {adminLoading ? 'Please wait...' : 'Login'}
                </button>
              </form>

              <div className="login-divider">
                <span>or</span>
              </div>

              <button onClick={() => navigateTo('wallet')} className="btn-secondary">
                Back to Wallet
              </button>
            </div>
          </div>
        </div>
      );
    }

    return (
      <div className={`app theme-${theme}`}>
        {/* Floating action buttons */}
        <div className="admin-floating-actions">
          <button onClick={() => navigateTo('wallet')} className="floating-btn wallet-btn" title="Back to Wallet">
            ←
          </button>
          <button onClick={handleAdminLogout} className="floating-btn logout-btn" title="Logout">
            ⏻
          </button>
        </div>

        <main className="admin-main">
          {/* User Management Section - Collapsible */}
          <section className="admin-card">
            <div className="admin-card-header clickable" onClick={() => setUsersExpanded(!usersExpanded)}>
              <h2>
                <span className={`dropdown-arrow ${usersExpanded ? 'expanded' : ''}`}>▶</span>
                User Management
                {nodeName && <span className="node-badge">Node: {nodeName}</span>}
                {dbUsers.length > 0 && <span className="count-badge">{dbUsers.length}</span>}
              </h2>
              <button
                onClick={(e) => { e.stopPropagation(); fetchDbUsers(); }}
                className="refresh-btn"
                disabled={adminLoading}
              >
                {adminLoading ? 'Loading...' : 'Refresh'}
              </button>
            </div>

            {adminError && (
              <div className={`transfer-status ${adminError.includes('error') || adminError.includes('Error') || adminError.includes('Failed') ? 'error' : 'success'}`}>
                {adminError}
              </div>
            )}

            {usersExpanded && (
              <div className="admin-users-table">
                <div className="admin-table-header">
                  <span>Username</span>
                  <span>Display Name</span>
                  <span>Role</span>
                  <span>Party ID</span>
                  <span>Actions</span>
                </div>
                {dbUsers.length === 0 ? (
                  <div className="no-transactions">No users found</div>
                ) : (
                  dbUsers.map((user) => (
                    <div key={user.id} className="admin-table-row">
                      <span className="admin-cell">{user.username}</span>
                      <span className="admin-cell">{user.display_name}</span>
                      <span className="admin-cell">
                        <select
                          value={user.role}
                          onChange={(e) => handleUpdateUserRole(user.id, e.target.value)}
                          className="role-select"
                        >
                          <option value="user">user</option>
                          <option value="admin">admin</option>
                        </select>
                      </span>
                      <span className="admin-cell party-id-cell" title={user.party_id || ''}>
                        {user.party_id || 'Not linked'}
                      </span>
                      <span className="admin-cell admin-actions">
                        <button
                          onClick={() => handleAdminTapFaucet(user.username)}
                          className="faucet-btn"
                          title="Add 100 CC to this user"
                        >
                          Faucet
                        </button>
                        <button
                          onClick={() => handleDeleteUser(user.id)}
                          className="delete-btn"
                        >
                          Delete
                        </button>
                      </span>
                    </div>
                  ))
                )}
              </div>
            )}
          </section>

          {/* Canton Parties Section - Collapsible */}
          <section className="admin-card">
            <div className="admin-card-header clickable" onClick={togglePartiesDropdown}>
              <h2>
                <span className={`dropdown-arrow ${partiesExpanded ? 'expanded' : ''}`}>▶</span>
                Canton Parties
                {cantonUsers.length > 0 && <span className="count-badge">{cantonUsers.length}</span>}
              </h2>
              <button
                onClick={(e) => { e.stopPropagation(); setShowCreateUser(true); }}
                className="send-btn"
                style={{ padding: '0.5rem 1rem', fontSize: '0.9rem' }}
              >
                + New Party
              </button>
            </div>

            {partiesExpanded && (
              <div className="admin-parties-list">
                {partiesLoading ? (
                  <div className="no-transactions">Loading parties...</div>
                ) : cantonUsers.length === 0 ? (
                  <div className="no-transactions">No parties found</div>
                ) : (
                  cantonUsers.map((user) => (
                    <div key={user.username} className="admin-party-item">
                      <div className="party-info">
                        <strong>{user.displayName || user.username}</strong>
                        <span className="party-username">@{user.username}</span>
                      </div>
                      {user.partyId && (
                        <div className="party-id-display">{user.partyId}</div>
                      )}
                    </div>
                  ))
                )}
              </div>
            )}
          </section>

          {/* Registration Codes Section - Collapsible */}
          <section className="admin-card">
            <div className="admin-card-header clickable" onClick={toggleRegCodesDropdown}>
              <h2>
                <span className={`dropdown-arrow ${regCodesExpanded ? 'expanded' : ''}`}>▶</span>
                Registration Codes
                {registrationCodes.length > 0 && <span className="count-badge">{registrationCodes.length}</span>}
              </h2>
              <button
                onClick={(e) => { e.stopPropagation(); setShowCreateCode(true); }}
                className="send-btn"
                style={{ padding: '0.5rem 1rem', fontSize: '0.9rem' }}
              >
                + New Code
              </button>
            </div>

            {regCodesExpanded && (
              <div className="admin-codes-list">
                {regCodesLoading ? (
                  <div className="no-transactions">Loading codes...</div>
                ) : registrationCodes.length === 0 ? (
                  <div className="no-transactions">No registration codes found</div>
                ) : (
                  <div className="admin-users-table">
                    <div className="admin-table-header">
                      <span>Code</span>
                      <span>Uses</span>
                      <span>Status</span>
                      <span>Actions</span>
                    </div>
                    {registrationCodes.map((code) => (
                      <div key={code.id} className="admin-table-row">
                        <span className="admin-cell">
                          <code style={{ fontFamily: 'monospace', fontWeight: 'bold' }}>{code.code}</code>
                        </span>
                        <span className="admin-cell">
                          {code.maxUses - code.usesRemaining} / {code.maxUses}
                        </span>
                        <span className="admin-cell">
                          {code.isDepleted ? (
                            <span style={{ color: '#dc3545' }}>Depleted</span>
                          ) : code.isExpired ? (
                            <span style={{ color: '#dc3545' }}>Expired</span>
                          ) : (
                            <span style={{ color: '#28a745' }}>Active</span>
                          )}
                        </span>
                        <span className="admin-cell admin-actions">
                          <button
                            onClick={() => copyCodeUrl(code.code)}
                            className="faucet-btn"
                            title="Copy registration URL"
                          >
                            Copy URL
                          </button>
                          <button
                            onClick={() => handleDeleteCode(code.id)}
                            className="delete-btn"
                          >
                            Delete
                          </button>
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </section>

          {/* DAR Upload Section - Collapsible */}
          <section className="admin-card">
            <div className="admin-card-header clickable" onClick={toggleDarDropdown}>
              <h2>
                <span className={`dropdown-arrow ${darExpanded ? 'expanded' : ''}`}>▶</span>
                Daml Packages
                {packageIds.length > 0 && <span className="count-badge">{packageIds.length}</span>}
              </h2>
              <label
                className="send-btn"
                style={{ padding: '0.5rem 1rem', fontSize: '0.9rem', cursor: darUploading ? 'not-allowed' : 'pointer' }}
                onClick={(e) => e.stopPropagation()}
              >
                {darUploading ? 'Uploading...' : '+ Upload DAR'}
                <input
                  type="file"
                  accept=".dar"
                  onChange={handleDarUpload}
                  disabled={darUploading}
                  style={{ display: 'none' }}
                />
              </label>
            </div>

            {darUploadStatus && (
              <div className={`transfer-status ${darUploadStatus.includes('Error') ? 'error' : 'success'}`} style={{ marginBottom: '1rem' }}>
                {darUploadStatus}
              </div>
            )}

            {darExpanded && (
              <div className="admin-packages-list">
                {packagesLoading ? (
                  <div className="no-transactions">Loading packages...</div>
                ) : packageIds.length === 0 ? (
                  <div className="no-transactions">No packages found</div>
                ) : (
                  <div className="packages-grid">
                    {packageIds.map((pkgId) => (
                      <div key={pkgId} className="package-item">
                        <code title={pkgId}>{pkgId.substring(0, 24)}...</code>
                        <button
                          onClick={() => {
                            navigator.clipboard.writeText(pkgId);
                            setDarUploadStatus('Package ID copied!');
                            setTimeout(() => setDarUploadStatus(''), 2000);
                          }}
                          className="copy-btn"
                          title="Copy package ID"
                        >
                          Copy
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </section>
        </main>

        {/* Create Code Modal */}
        {showCreateCode && (
          <div className="modal-overlay" onClick={() => setShowCreateCode(false)}>
            <div className="modal-content" onClick={(e) => e.stopPropagation()}>
              <h2>Create Registration Code</h2>
              <form onSubmit={handleCreateCode}>
                <div className="form-group">
                  <label>Max Uses</label>
                  <input
                    type="number"
                    value={newCodeMaxUses}
                    onChange={(e) => setNewCodeMaxUses(e.target.value)}
                    placeholder="e.g., 10"
                    min="1"
                    required
                  />
                </div>
                <div className="form-group">
                  <label>Expiry Date (optional)</label>
                  <input
                    type="datetime-local"
                    value={newCodeExpiry}
                    onChange={(e) => setNewCodeExpiry(e.target.value)}
                  />
                </div>
                <div className="modal-buttons">
                  <button
                    type="button"
                    onClick={() => {
                      setShowCreateCode(false);
                      setNewCodeMaxUses('10');
                      setNewCodeExpiry('');
                      setCreateCodeStatus('');
                    }}
                    className="refresh-btn"
                  >
                    Cancel
                  </button>
                  <button type="submit" className="send-btn">
                    Create Code
                  </button>
                </div>
              </form>
              {createCodeStatus && (
                <div className={`transfer-status ${createCodeStatus.includes('Error') ? 'error' : 'success'}`}>
                  {createCodeStatus}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Create Party Modal (shared) */}
        {showCreateUser && (
          <div className="modal-overlay" onClick={() => setShowCreateUser(false)}>
            <div className="modal-content" onClick={(e) => e.stopPropagation()}>
              <h2>Create New Party</h2>
              <form onSubmit={handleCreateParty}>
                <div className="form-group">
                  <label>Username (required)</label>
                  <input
                    type="text"
                    value={newUsername}
                    onChange={(e) => setNewUsername(e.target.value)}
                    placeholder="e.g., charlie"
                    required
                    pattern="[a-z0-9-_]+"
                    title="Only lowercase letters, numbers, hyphens, and underscores"
                  />
                </div>
                <div className="form-group">
                  <label>Display Name (optional)</label>
                  <input
                    type="text"
                    value={newDisplayName}
                    onChange={(e) => setNewDisplayName(e.target.value)}
                    placeholder="e.g., Charlie"
                  />
                </div>
                <div className="modal-buttons">
                  <button
                    type="button"
                    onClick={() => {
                      setShowCreateUser(false);
                      setNewUsername('');
                      setNewDisplayName('');
                      setCreateUserStatus('');
                    }}
                    className="refresh-btn"
                  >
                    Cancel
                  </button>
                  <button type="submit" className="send-btn">
                    Create Party
                  </button>
                </div>
              </form>
              {createUserStatus && (
                <div className={`transfer-status ${createUserStatus.includes('Error') ? 'error' : 'success'}`}>
                  {createUserStatus}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    );
  }

  // Loading screen for wallet view
  if (loading && !authUser) {
    return (
      <div className={`app theme-${theme}`}>
        <div className="loading">Loading...</div>
      </div>
    );
  }

  // Login screen for wallet view (not needed for admin)
  if (!authUser) {
    return (
      <div className={`app theme-${theme}`}>
        <div className="login-container">
          <div className="login-card">
            <h1>{orgName}</h1>
            <p className="login-subtitle">Secure Digital Asset Management</p>

            {loginError && (
              <div className="login-error">{loginError}</div>
            )}

            {/* Register section - username input + register button */}
            <div className="form-group">
              <label>Create Account</label>
              <input
                type="text"
                value={loginUsername}
                onChange={(e) => setLoginUsername(e.target.value)}
                placeholder="Choose a username"
                disabled={!codeValidation.valid}
              />
            </div>

            {/* Registration code status */}
            {codeValidation.checked && (
              <div style={{ marginBottom: '1rem', padding: '0.75rem', borderRadius: '8px', fontSize: '0.9rem',
                backgroundColor: codeValidation.valid ? 'rgba(40, 167, 69, 0.1)' : 'rgba(220, 53, 69, 0.1)',
                border: `1px solid ${codeValidation.valid ? 'rgba(40, 167, 69, 0.3)' : 'rgba(220, 53, 69, 0.3)'}`,
                color: codeValidation.valid ? '#28a745' : '#dc3545'
              }}>
                {codeValidation.valid ? (
                  <>Registration code valid ({codeValidation.usesRemaining} uses remaining)</>
                ) : codeValidation.reason === 'no_code' ? (
                  <>Registration code required. Contact admin for a registration link.</>
                ) : codeValidation.reason === 'invalid_code' ? (
                  <>Invalid registration code</>
                ) : codeValidation.reason === 'expired' ? (
                  <>Registration code has expired</>
                ) : codeValidation.reason === 'depleted' ? (
                  <>Registration code has been fully used</>
                ) : (
                  <>Unable to validate registration code</>
                )}
              </div>
            )}

            <button
              onClick={() => { setAuthMode('register'); handlePasskeyRegister(); }}
              className="send-btn"
              disabled={authLoading || !codeValidation.valid}
              style={!codeValidation.valid ? { opacity: 0.5, cursor: 'not-allowed' } : {}}
            >
              {authLoading && authMode === 'register' ? 'Please wait...' : 'Register with Passkey'}
            </button>

            <p className="passkey-info">
              Create an account using your device biometrics or security key
            </p>

            <div className="login-divider">
              <span>or</span>
            </div>

            {/* Sign in section - no username input */}
            <button
              onClick={() => { setAuthMode('login'); handlePasskeyLogin(); }}
              className="btn-secondary"
              disabled={authLoading}
            >
              {authLoading && authMode === 'login' ? 'Please wait...' : 'Sign In with Passkey'}
            </button>

            <p className="passkey-info">
              Sign in using your registered passkey
            </p>
          </div>
        </div>
      </div>
    );
  }

  // Main wallet view
  return (
    <div className={`app theme-${theme} ${chatOpen ? 'chat-open' : ''}`}>
      {/* AI Chat Toggle Button */}
      <button
        className="chat-toggle-btn"
        onClick={() => setChatOpen(!chatOpen)}
        title={chatOpen ? 'Close AI Assistant' : 'Open AI Assistant'}
      >
        {chatOpen ? '→' : '✨'}
      </button>

      <div className="main-content">
        <Wallet
          authUser={authUser}
          orgName={orgName}
          assets={assets.map(a => ({ ...a, icon: a.icon || null }))}
          transactions={transactions}
          transferOffers={transferOffers.map(o => ({
            contract_id: o.contract_id,
            payload: {
              sender: o.payload.sender,
              amount: { amount: o.payload.amount.amount }
            }
          }))}
          chainAddresses={chainAddresses.map(a => ({ ...a, icon: a.icon || '●' }))}
          scannedAddress={transferTo}
          onLogout={handleLogout}
          onNavigateAdmin={() => navigateTo('admin')}
          onRefresh={loadWalletData}
          onAddAsset={() => setShowAddAssetModal(true)}
          onDeleteAsset={handleDeleteCustomAsset}
          onAcceptOffer={handleAcceptOffer}
          onScannedAddressUsed={() => setTransferTo('')}
          onTransfer={async (to, amount, asset, chain) => {
            try {
              // Determine chain type from asset or chain parameter
              const chainType = asset?.chainType || (chain ? chainAddresses.find(a => a.chain === chain)?.chain : null);

              // Canton Coin - use Splice API
              if (!asset || asset.symbol === 'CC' || chainType === 'canton') {
                const response = await fetch(`${API_BASE}/api/wallet/transfer`, {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                    'X-Wallet-User': authUser.username,
                    'Authorization': `Bearer ${sessionId}`
                  },
                  body: JSON.stringify({
                    to,
                    amount: parseFloat(amount)
                  })
                });
                const data = await response.json() as ApiResponse<{ transactionId: string; status?: string }>;
                if (data.success && data.data) {
                  loadWalletData();
                  if (data.data.status === 'pending_acceptance') {
                    return { success: true, message: 'Transfer offer created! Waiting for recipient to accept.' };
                  }
                  return { success: true, message: `Success! TX: ${data.data.transactionId}` };
                }
                return { success: false, message: `Error: ${data.error}` };
              }

              // Non-Canton tokens - use chain signers with PRF authentication
              const prfOutput = await requestPrfAuthentication();
              if (!prfOutput) {
                return { success: false, message: 'Passkey authentication required for signing' };
              }

              const assetChainType = asset.chainType || 'evm';
              const keyRes = await fetch(`${API_BASE}/api/wallet/private-key?chainType=${assetChainType}`, {
                headers: { 'Authorization': `Bearer ${sessionId}` }
              });
              const keyData = await keyRes.json() as ApiResponse<{ encryptedKey: string }>;
              if (!keyData.success || !keyData.data) {
                return { success: false, message: 'Failed to get encrypted key' };
              }

              const privateKey = await decryptPrivateKey(prfOutput, keyData.data.encryptedKey);
              const amountNum = parseFloat(amount);

              // Route to appropriate chain signer
              switch (assetChainType) {
                case 'evm': {
                  // Get chain ID (default to Ethereum mainnet)
                  const chainId = chain === 'Base' ? 8453 : 1;
                  const evmAddr = chainAddresses.find(a => a.chain === 'Ethereum')?.address;
                  if (!evmAddr) {
                    return { success: false, message: 'No EVM wallet found' };
                  }
                  // Check balance before sending
                  const evmBalance = await evmSigner.getBalance(evmAddr, chainId);
                  const weiAmount = BigInt(Math.floor(amountNum * 1e18));
                  if (evmBalance < weiAmount) {
                    return { success: false, message: `Insufficient balance. Have: ${(Number(evmBalance) / 1e18).toFixed(6)} ${chain === 'Base' ? 'ETH (Base)' : 'ETH'}` };
                  }
                  const result = await evmSigner.signAndSendTransaction(
                    { to, value: '0x' + weiAmount.toString(16), chainId },
                    privateKey,
                    evmAddr
                  );
                  loadWalletData();
                  return { success: true, message: `Success! TX: ${result.transactionHash}` };
                }
                case 'btc': {
                  const btcAddr = chainAddresses.find(a => a.chain === 'Bitcoin')?.address;
                  if (!btcAddr) {
                    return { success: false, message: 'No Bitcoin wallet found' };
                  }
                  const satoshis = Math.floor(amountNum * 1e8);
                  const fee = 1000; // satoshis
                  // Check balance before sending
                  const btcBalance = await btcSigner.getBalance(btcAddr, 'mainnet');
                  if (btcBalance < satoshis + fee) {
                    return { success: false, message: `Insufficient BTC balance. Have: ${(btcBalance / 1e8).toFixed(8)} BTC` };
                  }
                  const utxos = await btcSigner.getUTXOs(btcAddr, 'mainnet');
                  if (utxos.length === 0) {
                    return { success: false, message: 'No UTXOs available' };
                  }
                  const result = await btcSigner.signAndSendTransaction(
                    utxos, to, satoshis, privateKey, btcAddr, fee, 'mainnet'
                  );
                  loadWalletData();
                  return { success: true, message: `Success! TX: ${result.txid}` };
                }
                case 'svm': {
                  const solAddr = chainAddresses.find(a => a.chain === 'Solana')?.address;
                  if (!solAddr) {
                    return { success: false, message: 'No Solana wallet found' };
                  }
                  // Check balance before sending
                  const solBalance = await solSigner.getBalance(solAddr, 'mainnet');
                  const lamports = Math.floor(amountNum * 1e9);
                  const fee = 5000; // transaction fee
                  const rentExemptMin = 890880; // minimum rent-exempt balance (~0.00089 SOL)
                  const minRequired = lamports + fee + rentExemptMin;

                  if (solBalance < minRequired) {
                    const maxSendable = Math.max(0, solBalance - fee - rentExemptMin) / 1e9;
                    return { success: false, message: `Insufficient SOL. Balance: ${(solBalance / 1e9).toFixed(6)} SOL. Max sendable: ${maxSendable.toFixed(6)} SOL (need to keep ~0.00089 SOL for rent)` };
                  }
                  const result = await solSigner.signAndSendTransaction(to, lamports, privateKey, 'mainnet');
                  loadWalletData();
                  return { success: true, message: `Success! TX: ${result.signature}` };
                }
                case 'tron': {
                  const tronAddr = chainAddresses.find(a => a.chain === 'Tron')?.address;
                  if (!tronAddr) {
                    return { success: false, message: 'No TRON wallet found' };
                  }
                  const sun = Math.floor(amountNum * 1e6);
                  // Check balance before sending
                  const trxBalance = await tronSigner.getBalance(tronAddr, 'mainnet');
                  if (trxBalance < sun) {
                    return { success: false, message: `Insufficient TRX balance. Have: ${(trxBalance / 1e6).toFixed(6)} TRX` };
                  }
                  const result = await tronSigner.signAndSendTransaction(to, sun, privateKey, 'mainnet');
                  loadWalletData();
                  return { success: true, message: `Success! TX: ${result.txID}` };
                }
                case 'ton': {
                  const tonAddr = chainAddresses.find(a => a.chain === 'TON')?.address;
                  if (!tonAddr) {
                    return { success: false, message: 'No TON wallet found' };
                  }
                  const nanotons = BigInt(Math.floor(amountNum * 1e9));
                  // Check balance before sending
                  const tonBalance = await tonSigner.getBalance(tonAddr, 'mainnet');
                  if (tonBalance < nanotons) {
                    return { success: false, message: `Insufficient TON balance. Have: ${(Number(tonBalance) / 1e9).toFixed(6)} TON` };
                  }
                  const result = await tonSigner.signAndSendTransaction(to, nanotons, privateKey, undefined, 'mainnet');
                  loadWalletData();
                  return { success: true, message: `Success! TX: ${result.hash}` };
                }
                default:
                  return { success: false, message: `Unsupported chain type: ${assetChainType}` };
              }
            } catch (error) {
              return { success: false, message: `Error: ${error}` };
            }
          }}
          onStartQrScanner={startQrScanner}
        />

      {/* QR Scanner Modal */}
      {showQrScanner && (
        <div className="modal-overlay" onClick={stopQrScanner}>
          <div className="qr-scanner-modal" onClick={(e) => e.stopPropagation()}>
            <div className="scanner-header">
              <span>Scan QR Code</span>
              <button onClick={stopQrScanner} className="btn-close">✕</button>
            </div>
            <div id="qr-reader" className="qr-reader"></div>
          </div>
        </div>
      )}

      {/* Create Party Modal */}
      {showCreateUser && (
        <div className="modal-overlay" onClick={() => setShowCreateUser(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <h2>Create New Party</h2>
            <form onSubmit={handleCreateParty}>
              <div className="form-group">
                <label>Username (required)</label>
                <input
                  type="text"
                  value={newUsername}
                  onChange={(e) => setNewUsername(e.target.value)}
                  placeholder="e.g., charlie"
                  required
                  pattern="[a-z0-9-_]+"
                  title="Only lowercase letters, numbers, hyphens, and underscores"
                />
              </div>
              <div className="form-group">
                <label>Display Name (optional)</label>
                <input
                  type="text"
                  value={newDisplayName}
                  onChange={(e) => setNewDisplayName(e.target.value)}
                  placeholder="e.g., Charlie"
                />
              </div>
              <div className="modal-buttons">
                <button
                  type="button"
                  onClick={() => {
                    setShowCreateUser(false);
                    setNewUsername('');
                    setNewDisplayName('');
                    setCreateUserStatus('');
                  }}
                  className="refresh-btn"
                >
                  Cancel
                </button>
                <button type="submit" className="send-btn">
                  Create Party
                </button>
              </div>
            </form>
            {createUserStatus && (
              <div className={`transfer-status ${createUserStatus.includes('Error') ? 'error' : 'success'}`}>
                {createUserStatus}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Add Custom Asset Modal */}
      {showAddAssetModal && (
        <div className="modal-overlay" onClick={() => setShowAddAssetModal(false)}>
          <div className="modal-content add-asset-modal" onClick={(e) => e.stopPropagation()}>
            <h2>Add Custom Asset</h2>
            <form onSubmit={handleAddCustomAsset}>
              <div className="form-group">
                <label>Chain</label>
                <select
                  value={newAsset.chain}
                  onChange={(e) => {
                    const selected = chainOptions.find(c => c.chain === e.target.value);
                    if (selected) {
                      setNewAsset({ ...newAsset, chain: selected.chain, chainType: selected.chainType });
                    }
                  }}
                  required
                >
                  {chainOptions.map(opt => (
                    <option key={opt.chainType} value={opt.chain}>{opt.chain}</option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label>Symbol (required)</label>
                <input
                  type="text"
                  value={newAsset.symbol}
                  onChange={(e) => setNewAsset({ ...newAsset, symbol: e.target.value.toUpperCase() })}
                  placeholder="e.g., LINK"
                  required
                  maxLength={10}
                />
              </div>
              <div className="form-group">
                <label>Name (required)</label>
                <input
                  type="text"
                  value={newAsset.name}
                  onChange={(e) => setNewAsset({ ...newAsset, name: e.target.value })}
                  placeholder="e.g., Chainlink"
                  required
                />
              </div>
              <div className="form-group">
                <label>Contract Address (required)</label>
                <input
                  type="text"
                  value={newAsset.contractAddress}
                  onChange={(e) => setNewAsset({ ...newAsset, contractAddress: e.target.value })}
                  placeholder="0x..."
                  required
                />
              </div>
              <div className="form-group">
                <label>Decimals</label>
                <input
                  type="number"
                  value={newAsset.decimals}
                  onChange={(e) => setNewAsset({ ...newAsset, decimals: parseInt(e.target.value) || 18 })}
                  min={0}
                  max={18}
                />
              </div>
              {addAssetError && (
                <div className="transfer-status error">{addAssetError}</div>
              )}
              <div className="modal-buttons">
                <button
                  type="button"
                  onClick={() => {
                    setShowAddAssetModal(false);
                    setNewAsset({ symbol: '', name: '', chain: 'Ethereum', chainType: 'evm', contractAddress: '', decimals: 18 });
                    setAddAssetError('');
                  }}
                  className="refresh-btn"
                >
                  Cancel
                </button>
                <button type="submit" className="send-btn">
                  Add Asset
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* macOS-style Dock */}
      <div
        className="dock-trigger"
        onMouseEnter={() => setDockVisible(true)}
      />
      <div
        className={`dock-container ${dockVisible ? 'visible' : ''}`}
        onMouseLeave={() => setDockVisible(false)}
      >
        <div className="dock">
          {dockApps.map((app, index) => {
            const hasSession = openAppSessions.has(app.id);
            const isActive = activeApp === app.id;
            return (
              <div
                key={app.id}
                className={`dock-item ${hoveredApp === app.id ? 'hovered' : ''} ${isActive ? 'active' : ''} ${hasSession ? 'has-session' : ''}`}
                style={{ '--app-color': app.color, '--item-index': index } as React.CSSProperties}
                onMouseEnter={() => setHoveredApp(app.id)}
                onMouseLeave={() => setHoveredApp(null)}
                onClick={() => {
                  if (isActive) {
                    // Clicking active app just hides it (minimize)
                    setActiveApp(null);
                  } else {
                    // Open or switch to app
                    setActiveApp(app.id);
                    // Add to open sessions if not already there
                    if (!hasSession) {
                      setOpenAppSessions(prev => new Set(prev).add(app.id));
                    }
                  }
                }}
              >
                <div className="dock-icon">
                  <span>{app.icon}</span>
                </div>
                <div className="dock-tooltip">{app.name}</div>
                {/* Show indicator if app has active session */}
                {hasSession && <div className="dock-indicator" />}
              </div>
            );
          })}
        </div>
      </div>

      {/* App Windows - render all open sessions, show/hide based on activeApp */}
      {Array.from(openAppSessions).map(appId => {
        const app = dockApps.find(a => a.id === appId);
        if (!app) return null;
        const appUrl = app.url;
        const isVisible = activeApp === appId;

        return (
          <div
            key={appId}
            className={`app-window ${isVisible ? 'visible' : 'hidden'}`}
            style={{ display: isVisible ? 'flex' : 'none' }}
          >
            <div className="app-window-header">
              <div className="app-window-title">
                {app.name}
              </div>
              <button
                className="app-window-close"
                onClick={() => {
                  // Terminate session - remove from open sessions and unregister iframe
                  setOpenAppSessions(prev => {
                    const newSet = new Set(prev);
                    newSet.delete(appId);
                    return newSet;
                  });
                  // Unregister the iframe
                  registerAppIframe(appId, null);
                  // Clear active app if this was the active one
                  if (activeApp === appId) {
                    setActiveApp(null);
                  }
                }}
              >✕</button>
            </div>
            <div className="app-window-content">
              {/* If app has URL, load in iframe */}
              {appUrl ? (
                <iframe
                  ref={(el) => registerAppIframe(appId, el)}
                  src={appUrl}
                  className="app-iframe"
                  title={app.name}
                  sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
                />
              ) : (
                /* Otherwise show placeholder UI */
                <>
                  {appId === 'swap' && (
                    <div className="dummy-app swap-app">
                      <div className="dummy-app-icon">⇄</div>
                      <h2>Token Swap</h2>
                      <p>Swap tokens across multiple chains</p>
                      <div className="dummy-swap-form">
                        <div className="swap-input-group">
                          <label>From</label>
                          <div className="swap-input">
                            <input type="text" placeholder="0.0" disabled />
                            <button className="token-select">ETH ▾</button>
                          </div>
                        </div>
                        <div className="swap-arrow">↓</div>
                        <div className="swap-input-group">
                          <label>To</label>
                          <div className="swap-input">
                            <input type="text" placeholder="0.0" disabled />
                            <button className="token-select">USDC ▾</button>
                          </div>
                        </div>
                        <button className="swap-button" disabled>Coming Soon</button>
                      </div>
                    </div>
                  )}
                  {appId === 'nft' && (
                    <div className="dummy-app nft-app">
                      <div className="dummy-app-icon">🖼</div>
                      <h2>RWA Marketplace</h2>
                      <p>View and manage your tokenized assets</p>
                      <div className="nft-grid">
                        {[1, 2, 3, 4, 5, 6].map(i => (
                          <div key={i} className="nft-placeholder">
                            <div className="nft-image">#{i}</div>
                            <div className="nft-name">Asset #{i}</div>
                          </div>
                        ))}
                      </div>
                      <p className="coming-soon-text">Coming Soon</p>
                    </div>
                  )}
                  {appId === 'defi' && (
                    <div className="dummy-app defi-app">
                      <div className="dummy-app-icon">📊</div>
                      <h2>DeFi Dashboard</h2>
                      <p>Track your DeFi positions and yields</p>
                      <div className="defi-stats">
                        <div className="defi-stat">
                          <span className="stat-label">Total Value Locked</span>
                          <span className="stat-value">$0.00</span>
                        </div>
                        <div className="defi-stat">
                          <span className="stat-label">Pending Rewards</span>
                          <span className="stat-value">$0.00</span>
                        </div>
                        <div className="defi-stat">
                          <span className="stat-label">APY</span>
                          <span className="stat-value">--%</span>
                        </div>
                      </div>
                      <p className="coming-soon-text">Coming Soon</p>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        );
      })}
      </div>

      {/* AI Chat Panel */}
      <div className={`chat-panel ${chatOpen ? 'open' : ''}`}>
        <div className="chat-header">
          <div className="chat-header-title">
            <span>AI Assistant</span>
          </div>
          <button className="chat-close-btn" onClick={() => setChatOpen(false)}>✕</button>
        </div>
        <div className="chat-messages">
          {chatMessages.map((msg, index) => (
            <div key={index} className={`chat-message ${msg.role}`}>
              <div className="chat-message-content">{msg.content}</div>
            </div>
          ))}
        </div>
        <form className="chat-input-form" onSubmit={handleSendChat}>
          <input
            type="text"
            value={chatInput}
            onChange={(e) => setChatInput(e.target.value)}
            placeholder="Ask me anything..."
            className="chat-input"
          />
          <button type="submit" className="chat-send-btn">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="22" y1="2" x2="11" y2="13"/>
              <polygon points="22 2 15 22 11 13 2 9 22 2"/>
            </svg>
          </button>
        </form>
      </div>
    </div>
  );
}

export default App;
