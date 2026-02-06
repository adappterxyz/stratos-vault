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
import {
  ShieldCheck,
  Users,
  KeyRound,
  Globe,
  LayoutGrid,
  Settings,
  LogOut
} from 'lucide-react';
import './themes/index.css';
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
  chainBalances?: Record<string, number>;  // Per-chain balance breakdown (e.g., { "Ethereum": 100, "Base": 50 })
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
  id: string;
  txHash: string | null;
  type: string;
  status: string;
  asset: string;
  chain: string;
  chainType: string;
  amount: string;
  amountUsd: string | null;
  fee: string | null;
  feeAsset: string | null;
  from: string | null;
  to: string | null;
  description: string | null;
  metadata: Record<string, any> | null;
  blockNumber: number | null;
  blockTimestamp: string | null;
  createdAt: string;
}

interface TransactionPagination {
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
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

interface TransactionsApiResponse {
  success: boolean;
  data?: Transaction[];
  pagination?: TransactionPagination;
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

// Snap-to-grid helper
const SNAP_GRID = 1;
const snap = (value: number, grid: number) => grid <= 1 ? value : Math.round(value / grid) * grid;

// LocalStorage key for app window state persistence
const STORAGE_KEY = 'wallet-app-window-state';

function App() {
  // Path-based view detection
  const [currentView, setCurrentView] = useState<'wallet' | 'admin'>(() => {
    const path = window.location.pathname.toLowerCase().replace(/\/$/, ''); // normalize path
    if (path.startsWith('/admin')) return 'admin';
    return 'wallet';
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
  const [transactionPagination, setTransactionPagination] = useState<TransactionPagination | null>(null);
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

  // Settings / Passkey management
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [passkeys, setPasskeys] = useState<Array<{ id: string; name: string; deviceType: string; backedUp: boolean; transports: string[]; createdAt: string }>>([]);
  const [settingsLoading, setSettingsLoading] = useState(false);
  const [settingsError, setSettingsError] = useState('');
  const [deletingPasskeyId, setDeletingPasskeyId] = useState<string | null>(null);
  const [addingPasskey, setAddingPasskey] = useState(false);
  const [newPasskeyName, setNewPasskeyName] = useState('');

  // Dock state
  const [dockVisible, setDockVisible] = useState(false);
  const [activeApp, setActiveApp] = useState<string | null>(null);
  const [hoveredApp, setHoveredApp] = useState<string | null>(null);
  // Track which apps have active sessions (opened but not closed)
  const [openAppSessions, setOpenAppSessions] = useState<Set<string>>(() => {
    try {
      const saved = localStorage.getItem('wallet-app-window-state');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed.openAppSessions)) {
          return new Set<string>(parsed.openAppSessions);
        }
      }
    } catch {}
    return new Set<string>();
  });
  // Track package installation status per app: 'checking' | 'installing' | 'ready' | 'error' | null
  const [appPackageStatus, setAppPackageStatus] = useState<Record<string, { status: string; message?: string }>>({});

  // Dock apps configuration - loaded from API
  const [dockApps, setDockApps] = useState<Array<{ id: string; name: string; icon: string; color: string; url: string | null; zoom?: number }>>([]);
  const [allowedIframeOrigins, setAllowedIframeOrigins] = useState<string[]>([]);

  // Wallet Bridge for iframe communication
  const walletBridgeRef = useRef<WalletBridge | null>(null);
  const loadingWalletRef = useRef(false); // Prevent concurrent loadWalletData calls
  const lastLoadTimeRef = useRef(0); // Throttle repeated calls
  const initialLoadDoneRef = useRef(false); // Track if initial load completed
  const iframeRefs = useRef<Map<string, HTMLIFrameElement>>(new Map());

  // Floating app window state: per-app position, size, and mode
  const [floatingApps, setFloatingApps] = useState<Record<string, { floating: boolean; x: number; y: number; width: number; height: number }>>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        return parsed.floatingApps || {};
      }
    } catch {}
    return {};
  });
  const [focusedApp, setFocusedApp] = useState<string | null>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        return parsed.focusedApp || null;
      }
    } catch {}
    return null;
  });
  const [appZoom, setAppZoom] = useState<Record<string, number>>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        return parsed.appZoom || {};
      }
    } catch {}
    return {};
  });
  const [zoomTooltipApp, setZoomTooltipApp] = useState<string | null>(null);
  const zoomTooltipTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [snapLayoutVisible, setSnapLayoutVisible] = useState(false);
  const [snapLayoutHovered, setSnapLayoutHovered] = useState<number | null>(null);
  const [snapLayoutPosition, setSnapLayoutPosition] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const snapLayoutHoveredRef = useRef<number | null>(null);
  const floatingAppsRef = useRef(floatingApps);
  floatingAppsRef.current = floatingApps;
  const appDragRef = useRef<{ appId: string; startX: number; startY: number; startPosX: number; startPosY: number; active: boolean } | null>(null);
  const appResizeRef = useRef<{ appId: string; startX: number; startY: number; startW: number; startH: number; active: boolean } | null>(null);

  // Direct DOM manipulation during drag/resize for smooth performance.
  // React state is only updated on pointer-up to commit the final position.
  // A 4px dead-zone prevents accidental drags on simple clicks.
  const rafRef = useRef<number>(0);
  const DRAG_THRESHOLD = 4;

  const SNAP_EDGE_THRESHOLD = 50; // pixels from edge to trigger snap layout

  const handleAppPointerMove = useCallback((e: MouseEvent | TouchEvent) => {
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;

    if (appDragRef.current) {
      const drag = appDragRef.current;
      // Activate only after moving past threshold
      if (!drag.active) {
        if (Math.abs(clientX - drag.startX) < DRAG_THRESHOLD && Math.abs(clientY - drag.startY) < DRAG_THRESHOLD) return;
        drag.active = true;
        document.querySelectorAll('.app-iframe').forEach(f => (f as HTMLElement).style.pointerEvents = 'none');
        document.body.style.userSelect = 'none';
      }
      e.preventDefault();
      let newX = clientX - drag.startX + drag.startPosX;
      let newY = clientY - drag.startY + drag.startPosY;
      // Prevent dragging header off-screen (keep at least 40px of header visible at top)
      newY = Math.max(0, newY);
      cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(() => {
        const el = document.querySelector(`[data-floating-app="${drag.appId}"]`) as HTMLElement | null;
        if (el) {
          el.style.left = `${newX}px`;
          el.style.top = `${newY}px`;
        }
      });

      // Detect edge proximity for snap layout picker (left or right edge only)
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const nearLeft = clientX < SNAP_EDGE_THRESHOLD;
      const nearRight = clientX > vw - SNAP_EDGE_THRESHOLD;

      if (nearLeft || nearRight) {
        setSnapLayoutVisible(true);
        // Position picker on the opposite side from cursor
        const pickerX = nearLeft ? 80 : vw - 200;
        setSnapLayoutPosition({ x: pickerX, y: Math.min(vh - 150, Math.max(50, clientY - 50)) });

        // Auto-select layout based on vertical position
        const floatingCount = Object.values(floatingAppsRef.current).filter(s => s.floating).length;
        const layoutCount = floatingCount === 1 ? 2 : floatingCount === 2 ? 2 : floatingCount === 3 ? 3 : 2;
        const zoneHeight = vh / layoutCount;
        const layoutIndex = Math.min(layoutCount - 1, Math.floor(clientY / zoneHeight));
        setSnapLayoutHovered(layoutIndex);
        snapLayoutHoveredRef.current = layoutIndex;
      } else {
        setSnapLayoutVisible(false);
        setSnapLayoutHovered(null);
        snapLayoutHoveredRef.current = null;
      }
    }
    if (appResizeRef.current) {
      const resize = appResizeRef.current;
      if (!resize.active) {
        if (Math.abs(clientX - resize.startX) < DRAG_THRESHOLD && Math.abs(clientY - resize.startY) < DRAG_THRESHOLD) return;
        resize.active = true;
        document.querySelectorAll('.app-iframe').forEach(f => (f as HTMLElement).style.pointerEvents = 'none');
        document.body.style.userSelect = 'none';
      }
      e.preventDefault();
      const newW = Math.max(280, resize.startW + clientX - resize.startX);
      const newH = Math.max(300, resize.startH + clientY - resize.startY);
      cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(() => {
        const el = document.querySelector(`[data-floating-app="${resize.appId}"]`) as HTMLElement | null;
        if (el) {
          el.style.width = `${newW}px`;
          el.style.height = `${newH}px`;
        }
      });
    }
  }, []);

  const handleAppPointerUp = useCallback(() => {
    // Commit final position from DOM to React state only if drag/resize was activated
    const drag = appDragRef.current;
    const resize = appResizeRef.current;
    const pendingLayout = snapLayoutHoveredRef.current;

    // Re-enable iframe pointer events first
    document.querySelectorAll('.app-iframe').forEach(f => (f as HTMLElement).style.pointerEvents = '');
    document.body.style.userSelect = '';

    if (drag?.active && pendingLayout !== null) {
      // Apply layout to all floating windows
      const currentFloating = floatingAppsRef.current;
      const floatingAppIds = Object.entries(currentFloating)
        .filter(([_, state]) => state.floating)
        .map(([id]) => id);

      const count = floatingAppIds.length;
      if (count > 0) {
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        const gap = 3;

        const getPositions = (): Array<{ x: number; y: number; width: number; height: number }> => {
          if (count === 1) {
            if (pendingLayout === 0) {
              return [{ x: vw * 0.1, y: vh * 0.1, width: vw * 0.8, height: vh * 0.8 }];
            }
            return [{ x: gap, y: gap, width: vw - gap * 2, height: vh - gap * 2 }];
          }
          if (count === 2) {
            if (pendingLayout === 0) {
              const w = (vw - gap * 3) / 2;
              return [
                { x: gap, y: gap, width: w, height: vh - gap * 2 },
                { x: gap * 2 + w, y: gap, width: w, height: vh - gap * 2 },
              ];
            }
            const h = (vh - gap * 3) / 2;
            return [
              { x: gap, y: gap, width: vw - gap * 2, height: h },
              { x: gap, y: gap * 2 + h, width: vw - gap * 2, height: h },
            ];
          }
          if (count === 3) {
            const w = (vw - gap * 3) / 2;
            const h = (vh - gap * 3) / 2;
            if (pendingLayout === 0) {
              return [
                { x: gap, y: gap, width: w, height: vh - gap * 2 },
                { x: gap * 2 + w, y: gap, width: w, height: h },
                { x: gap * 2 + w, y: gap * 2 + h, width: w, height: h },
              ];
            }
            if (pendingLayout === 1) {
              return [
                { x: gap, y: gap, width: w, height: h },
                { x: gap, y: gap * 2 + h, width: w, height: h },
                { x: gap * 2 + w, y: gap, width: w, height: vh - gap * 2 },
              ];
            }
            const w3 = (vw - gap * 4) / 3;
            return [
              { x: gap, y: gap, width: w3, height: vh - gap * 2 },
              { x: gap * 2 + w3, y: gap, width: w3, height: vh - gap * 2 },
              { x: gap * 3 + w3 * 2, y: gap, width: w3, height: vh - gap * 2 },
            ];
          }
          if (pendingLayout === 0) {
            const cols = 2;
            const rows = Math.ceil(count / cols);
            const w = (vw - gap * (cols + 1)) / cols;
            const h = (vh - gap * (rows + 1)) / rows;
            return floatingAppIds.map((_, i) => ({
              x: gap + (i % cols) * (w + gap),
              y: gap + Math.floor(i / cols) * (h + gap),
              width: w,
              height: h,
            }));
          }
          const w = (vw - gap * (count + 1)) / count;
          return floatingAppIds.map((_, i) => ({
            x: gap + i * (w + gap),
            y: gap,
            width: w,
            height: vh - gap * 2,
          }));
        };

        const positions = getPositions();
        floatingAppIds.forEach((id, i) => {
          if (positions[i]) {
            const el = document.querySelector(`[data-floating-app="${id}"]`) as HTMLElement | null;
            if (el) {
              el.style.left = `${positions[i].x}px`;
              el.style.top = `${positions[i].y}px`;
              el.style.width = `${positions[i].width}px`;
              el.style.height = `${positions[i].height}px`;
            }
          }
        });

        setFloatingApps(prev => {
          const updated = { ...prev };
          floatingAppIds.forEach((id, i) => {
            if (positions[i]) {
              updated[id] = { ...updated[id], ...positions[i] };
            }
          });
          return updated;
        });
      }
    } else if (drag?.active) {
      const el = document.querySelector(`[data-floating-app="${drag.appId}"]`) as HTMLElement | null;
      if (el) {
        setFloatingApps(prev => ({
          ...prev,
          [drag.appId]: { ...prev[drag.appId], x: parseFloat(el.style.left) || 0, y: parseFloat(el.style.top) || 0 },
        }));
      }
    }

    if (resize?.active) {
      const el = document.querySelector(`[data-floating-app="${resize.appId}"]`) as HTMLElement | null;
      if (el) {
        setFloatingApps(prev => ({
          ...prev,
          [resize.appId]: { ...prev[resize.appId], width: parseFloat(el.style.width) || 400, height: parseFloat(el.style.height) || 400 },
        }));
      }
    }

    appDragRef.current = null;
    appResizeRef.current = null;
    setSnapLayoutVisible(false);
    setSnapLayoutHovered(null);
    snapLayoutHoveredRef.current = null;
  }, []);

  useEffect(() => {
    const hasFloating = Object.values(floatingApps).some(a => a.floating);
    if (!hasFloating) return;
    document.addEventListener('mousemove', handleAppPointerMove);
    document.addEventListener('mouseup', handleAppPointerUp);
    document.addEventListener('touchmove', handleAppPointerMove, { passive: false });
    document.addEventListener('touchend', handleAppPointerUp);
    return () => {
      document.removeEventListener('mousemove', handleAppPointerMove);
      document.removeEventListener('mouseup', handleAppPointerUp);
      document.removeEventListener('touchmove', handleAppPointerMove);
      document.removeEventListener('touchend', handleAppPointerUp);
    };
  }, [floatingApps, handleAppPointerMove, handleAppPointerUp]);

  // Persist app window state to localStorage
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        openAppSessions: Array.from(openAppSessions),
        floatingApps,
        focusedApp,
        appZoom,
      }));
    } catch {}
  }, [openAppSessions, floatingApps, focusedApp, appZoom]);

  const startAppDrag = (appId: string, e: React.MouseEvent | React.TouchEvent) => {
    const state = floatingApps[appId];
    if (!state?.floating) return;
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
    appDragRef.current = { appId, startX: clientX, startY: clientY, startPosX: state.x, startPosY: state.y, active: false };
  };

  const startAppResize = (appId: string, e: React.MouseEvent | React.TouchEvent) => {
    e.stopPropagation();
    const state = floatingApps[appId];
    if (!state?.floating) return;
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
    appResizeRef.current = { appId, startX: clientX, startY: clientY, startW: state.width, startH: state.height, active: false };
  };

  const toggleAppFloating = (appId: string) => {
    setFloatingApps(prev => {
      const current = prev[appId];
      if (current?.floating) {
        // Return to fullscreen — remove entry and set as active app
        setActiveApp(appId);
        const { [appId]: _, ...rest } = prev;
        return rest;
      }
      // Enter floating mode — center on screen (snapped to grid)
      const width = snap(800, SNAP_GRID);
      const height = snap(600, SNAP_GRID);
      return {
        ...prev,
        [appId]: {
          floating: true,
          x: snap(Math.round((window.innerWidth - width) / 2), SNAP_GRID),
          y: snap(Math.round((window.innerHeight - height) / 2), SNAP_GRID),
          width,
          height,
        },
      };
    });
  };

  // AI Chat state
  const [chatOpen, setChatOpen] = useState(false);
  const [chatMessages, setChatMessages] = useState<{ role: 'user' | 'assistant'; content: string }[]>([
    { role: 'assistant', content: 'Hello! I\'m your AI assistant. How can I help you with your wallet today?' }
  ]);
  const [chatInput, setChatInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const [chatAgentWebhookUrl, setChatAgentWebhookUrl] = useState<string | null>(null);
  const [customLogo, setCustomLogo] = useState<string | null>(null);

  const handleSendChat = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim() || chatLoading || !chatAgentWebhookUrl) return;

    const userMessage = chatInput;
    setChatInput('');
    setChatMessages(prev => [...prev, { role: 'user', content: userMessage }]);
    setChatLoading(true);

    try {
      const res = await fetch(chatAgentWebhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: userMessage,
          sessionId: authUser?.id,
          name: authUser?.displayName || authUser?.username || 'Web User',
        }),
      });

      const json = await res.json() as { reply?: string; sessionId?: string; conversationId?: string };

      if (json.reply) {
        setChatMessages(prev => [...prev, { role: 'assistant', content: json.reply! }]);
      } else {
        setChatMessages(prev => [...prev, { role: 'assistant', content: 'Sorry, something went wrong. Please try again.' }]);
      }
    } catch {
      setChatMessages(prev => [...prev, { role: 'assistant', content: 'Unable to reach the assistant. Please try again later.' }]);
    } finally {
      setChatLoading(false);
    }
  };

  // Login form
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [loginUsername, setLoginUsername] = useState('');
  const [loginError, setLoginError] = useState('');
  const [authLoading, setAuthLoading] = useState(false);

  // Admin panel state
  const [dbUsers, setDbUsers] = useState<DbUser[]>([]);
  const [adminLoading, setAdminLoading] = useState(false);
  const [nodeName, setNodeName] = useState<string | null>(null);
  const [cantonVersion, setCantonVersion] = useState<string | null>(null);
  const [showPartiesModal, setShowPartiesModal] = useState(false);
  const [showPackagesModal, setShowPackagesModal] = useState(false);
  const [partiesLoading, setPartiesLoading] = useState(false);
  const [adminToken] = useState<string | null>(() => localStorage.getItem('adminToken'));

  // Superadmin state
  interface SuperadminUser {
    id: string;
    username: string;
    displayName: string | null;
    isSuperadmin: boolean;
  }
  interface AdminUserRow {
    id: string;
    username: string;
    displayName: string | null;
    isSuperadmin: boolean;
    createdAt: string;
    updatedAt: string;
    createdBy: string | null;
  }
  interface ConfigData {
    RP_NAME: string;
    THEME: string;
    ORG_NAME: string;
    CHAT_AGENT_WEBHOOK_URL: string;
    SPLICE_HOST: string;
    CANTON_JSON_HOST: string;
  }
  interface RpcEndpointRow {
    id: string;
    chain_type: string;
    chain_name: string;
    chain_id: string | null;
    network: string;
    name: string | null;
    rpc_url: string;
    priority: number;
    is_enabled: number;
    created_at: string;
    updated_at: string;
  }
  interface AppRow {
    id: string;
    name: string;
    icon: string;
    color: string;
    url: string | null;
    zoom: number;
    sort_order: number;
    is_enabled: number;
    created_at: string;
    updated_at: string;
  }
  const [superadminToken, setSuperadminToken] = useState<string | null>(() => localStorage.getItem('superadminToken'));
  const [superadminUser, setSuperadminUser] = useState<SuperadminUser | null>(null);
  const [superadminUsername, setSuperadminUsername] = useState('');
  const [superadminPassword, setSuperadminPassword] = useState('');
  const [superadminLoading, setSuperadminLoading] = useState(false);
  const [superadminError, setSuperadminError] = useState('');
  const [adminUsers, setAdminUsers] = useState<AdminUserRow[]>([]);
  const [configData, setConfigData] = useState<ConfigData | null>(null);
  const [boundServices, setBoundServices] = useState<Record<string, string> | null>(null);
  const [showCreateAdminUser, setShowCreateAdminUser] = useState(false);
  const [newAdminUsername, setNewAdminUsername] = useState('');
  const [newAdminPassword, setNewAdminPassword] = useState('');
  const [newAdminDisplayName, setNewAdminDisplayName] = useState('');
  const [newAdminIsSuperadmin, setNewAdminIsSuperadmin] = useState(false);
  const [editingConfig, setEditingConfig] = useState(false);
  const [editConfigData, setEditConfigData] = useState<ConfigData | null>(null);
  const [superadminSection, setSuperadminSection] = useState<'admin-users' | 'config' | 'users' | 'codes' | 'rpc' | 'apps'>('admin-users');
  const [adminSidebarCollapsed, setAdminSidebarCollapsed] = useState(false);
  const [rpcNetworkMode, setRpcNetworkMode] = useState<'mainnet' | 'testnet'>('mainnet');
  const [rpcEndpoints, setRpcEndpoints] = useState<RpcEndpointRow[]>([]);
  const [rpcLoading, setRpcLoading] = useState(false);
  const [showAddRpc, setShowAddRpc] = useState(false);
  const [editingRpc, setEditingRpc] = useState<RpcEndpointRow | null>(null);
  const [newRpc, setNewRpc] = useState({ chain_type: 'evm', chain_name: 'Ethereum', chain_id: '1', network: 'mainnet', name: '', rpc_url: '', priority: 0, is_enabled: true });
  const [availableChains, setAvailableChains] = useState<Array<{ chain: string; chain_type: string; chain_id: string | null; network: string }>>([]);
  const [appsList, setAppsList] = useState<AppRow[]>([]);
  const [appsLoading, setAppsLoading] = useState(false);
  const [showAddApp, setShowAddApp] = useState(false);
  const [editingApp, setEditingApp] = useState<AppRow | null>(null);
  const [newApp, setNewApp] = useState({ id: '', name: '', icon: '', color: '#6366f1', url: '', sort_order: 0, is_enabled: true });
  const [emojiPickerTarget, setEmojiPickerTarget] = useState<'new' | 'edit' | null>(null);

  // App access control state
  interface AppAccessUser { user_id: string; username: string; display_name: string | null }
  const [appAccessMap, setAppAccessMap] = useState<Record<string, string[]>>({});
  const [appAccessUsers, setAppAccessUsers] = useState<Record<string, AppAccessUser[]>>({});
  const [appAccessModalApp, setAppAccessModalApp] = useState<AppRow | null>(null);
  const [appAccessSearch, setAppAccessSearch] = useState('');
  const [userAppAccessModalUser, setUserAppAccessModalUser] = useState<DbUser | null>(null);

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
    codeType: 'general' | 'reserved_username';
    reservedUsername: string | null;
  }[]>([]);
  const [regCodesLoading, setRegCodesLoading] = useState(false);
  const [showCreateCode, setShowCreateCode] = useState(false);
  const [newCodeMaxUses, setNewCodeMaxUses] = useState('10');
  const [newCodeExpiry, setNewCodeExpiry] = useState('');
  const [newCodeType, setNewCodeType] = useState<'general' | 'reserved_username'>('general');
  const [newCodeReservedUsername, setNewCodeReservedUsername] = useState('');
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
    codeType?: string;
    reservedUsername?: string | null;
    checked: boolean;
  }>({ valid: false, checked: false });

  // Theme and org state
  const [theme, setTheme] = useState<string>('purple');
  const [orgName, setOrgName] = useState<string>('Canton Wallet');
  const [networkMode, setNetworkMode] = useState<'mainnet' | 'testnet'>(() => {
    const saved = localStorage.getItem('walletNetworkMode');
    return (saved === 'testnet') ? 'testnet' : 'mainnet';
  });

  // DAR upload state
  const [darUploading, setDarUploading] = useState(false);
  const [darUploadStatus, setDarUploadStatus] = useState('');
  const [packageIds, setPackageIds] = useState<string[]>([]);
  const [packagesLoading, setPackagesLoading] = useState(false);
  const [showInstallFromUrl, setShowInstallFromUrl] = useState(false);
  const [darInstallUrl, setDarInstallUrl] = useState('');


  // Handle browser back/forward navigation
  useEffect(() => {
    const handlePopState = () => {
      const path = window.location.pathname.toLowerCase().replace(/\/$/, '');
      if (path === '/admin') setCurrentView('admin');
      else setCurrentView('wallet');
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  // Fetch theme, org name, dock apps (with optional auth for per-user app filtering)
  const fetchConfig = async (token?: string | null) => {
    try {
      const headers: Record<string, string> = {};
      const authToken = token ?? sessionId;
      if (authToken) {
        headers['Authorization'] = `Bearer ${authToken}`;
      }
      const res = await fetch(`${API_BASE}/api/config`, { headers });
      const data = await res.json() as ApiResponse<{
        theme: string;
        orgName: string;
        dockApps: Array<{ id: string; name: string; icon: string; color: string; url: string | null; zoom?: number }>;
        allowedIframeOrigins: string[];
        rpcEndpoints?: {
          evm?: Record<string, string>;
          btc?: Record<string, string>;
          svm?: Record<string, string>;
          tron?: Record<string, string>;
          ton?: Record<string, string>;
        };
        chatAgentWebhookUrl?: string | null;
        logo?: string | null;
      }>;
      if (data.success && data.data) {
        if (data.data.theme) setTheme(data.data.theme);
        if (data.data.orgName) {
          setOrgName(data.data.orgName);
          document.title = data.data.orgName;
        }
        if (data.data.dockApps) {
          setDockApps(data.data.dockApps);
        }
        if (data.data.allowedIframeOrigins) {
          setAllowedIframeOrigins(data.data.allowedIframeOrigins);
        }
        // Configure RPC endpoints for signers
        if (data.data.rpcEndpoints) {
          const rpc = data.data.rpcEndpoints;
          if (rpc.evm) evmSigner.setEvmRpcEndpoints(rpc.evm);
          if (rpc.btc) btcSigner.setBtcRpcEndpoints(rpc.btc);
          if (rpc.svm) solSigner.setSolRpcEndpoints(rpc.svm);
          if (rpc.tron) tronSigner.setTronRpcEndpoints(rpc.tron);
          if (rpc.ton) tonSigner.setTonRpcEndpoints(rpc.ton);
        }
        if (data.data.chatAgentWebhookUrl) {
          setChatAgentWebhookUrl(data.data.chatAgentWebhookUrl);
        }
        if (data.data.logo) {
          setCustomLogo(data.data.logo);
        }
      }
    } catch (error) {
      console.error('Failed to fetch config:', error);
    }
  };

  // Fetch config on mount and re-fetch when session changes (for per-user app filtering)
  useEffect(() => {
    fetchConfig();
  }, [sessionId]);

  // Check session on mount
  useEffect(() => {
    if (sessionId) {
      checkSession();
    } else {
      setLoading(false);
    }
  }, []);

  // Load wallet data when authenticated (only once on initial auth)
  useEffect(() => {
    if (authUser && !initialLoadDoneRef.current) {
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
      chains: a.chains || [],
      chainBalances: a.chainBalances || {},
    }));
  }, [assets]);

  const getTransactions = useCallback(() => {
    return transactions.map(tx => ({
      transactionId: tx.id,
      type: tx.type as 'send' | 'receive',
      amount: parseFloat(tx.amount),
      symbol: tx.asset,
      from: tx.from || '',
      to: tx.to || '',
      chain: tx.chainType,
      timestamp: tx.createdAt,
      status: tx.status as 'pending' | 'confirmed' | 'failed',
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
          loadWalletData(true);
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
          loadWalletData(true);
          return { txId: data.data.transactionId, status: 'confirmed' };
        }
        throw new Error(data.error || 'Accept offer failed');
      },
      onRefresh: async () => {
        await loadWalletData(true);
      },
      // Canton Generic Contract Operations
      onCantonQuery: async (params: { templateId: string; filter?: Record<string, unknown>; readAs?: string[] }) => {
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
      // Canton User Rights
      onGrantUserRights: async (params: { userId: string; rights: Array<{ type: 'actAs' | 'readAs'; party: string } | { type: 'participantAdmin' }> }) => {
        const response = await fetch(`${API_BASE}/api/canton/grant-rights`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${sessionId}`
          },
          body: JSON.stringify(params)
        });
        const data = await response.json() as ApiResponse<{ userId: string; grantedRights: typeof params.rights }>;
        if (data.success && data.data) {
          return { success: true, userId: data.data.userId, grantedRights: data.data.grantedRights };
        }
        throw new Error(data.error || 'Grant rights failed');
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
  }, [authUser, sessionId, allowedIframeOrigins]); // Only recreate bridge on auth/session/origins change

  // Update getter callbacks when they change (without recreating bridge, preserving registered iframes)
  useEffect(() => {
    if (walletBridgeRef.current) {
      walletBridgeRef.current.updateCallbacks({
        getUser,
        getAddresses,
        getAssets,
        getTransactions,
        getTransferOffers,
      });
    }
  }, [getUser, getAddresses, getAssets, getTransactions, getTransferOffers]);

  // Notify iframes when assets change
  useEffect(() => {
    if (assets.length > 0 && walletBridgeRef.current) {
      walletBridgeRef.current.notifyAssetsChanged();
    }
  }, [assets]);

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

  // === Passkey Management ===
  const loadPasskeys = async () => {
    if (!sessionId) return;
    setSettingsLoading(true);
    setSettingsError('');
    try {
      const res = await fetch(`${API_BASE}/api/auth/passkeys`, {
        headers: { 'Authorization': `Bearer ${sessionId}` }
      });
      const data = await res.json() as ApiResponse<Array<{ id: string; name: string; deviceType: string; backedUp: boolean; transports: string[]; createdAt: string }>>;
      if (data.success && data.data) {
        setPasskeys(data.data);
      } else {
        setSettingsError(data.error || 'Failed to load passkeys');
      }
    } catch (error) {
      setSettingsError('Failed to load passkeys');
    } finally {
      setSettingsLoading(false);
    }
  };

  const handleAddPasskey = async (passkeyName: string) => {
    if (!sessionId) return;
    setAddingPasskey(true);
    setSettingsError('');
    try {
      // Get add-passkey options
      const optionsRes = await fetch(`${API_BASE}/api/auth/passkey/add-options`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${sessionId}`
        }
      });
      const optionsData = await optionsRes.json() as ApiResponse<{ options: any }>;
      if (!optionsData.success || !optionsData.data) {
        throw new Error(optionsData.error || 'Failed to get options');
      }

      const options = optionsData.data.options;

      // Convert for native WebAuthn API
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
      };

      const credential = await navigator.credentials.create({
        publicKey: publicKeyOptions
      }) as PublicKeyCredential;

      if (!credential) {
        throw new Error('Failed to create credential');
      }

      const response = credential.response as AuthenticatorAttestationResponse;

      const credentialJSON = {
        id: credential.id,
        rawId: bufferToBase64URLString(credential.rawId),
        type: credential.type,
        response: {
          clientDataJSON: bufferToBase64URLString(response.clientDataJSON),
          attestationObject: bufferToBase64URLString(response.attestationObject),
          transports: response.getTransports?.() || []
        },
        clientExtensionResults: {}
      };

      // Verify
      const verifyRes = await fetch(`${API_BASE}/api/auth/passkey/add-verify`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${sessionId}`
        },
        body: JSON.stringify({ response: credentialJSON, name: passkeyName || undefined })
      });
      const verifyData = await verifyRes.json() as ApiResponse<{ id: string }>;
      if (!verifyData.success) {
        throw new Error(verifyData.error || 'Verification failed');
      }

      setNewPasskeyName('');
      // Reload passkey list
      await loadPasskeys();
    } catch (error: any) {
      if (error.name !== 'NotAllowedError') {
        setSettingsError(error.message || 'Failed to add passkey');
      }
    } finally {
      setAddingPasskey(false);
    }
  };

  const handleDeletePasskey = async (id: string) => {
    if (!sessionId) return;
    setDeletingPasskeyId(id);
    setSettingsError('');
    try {
      const res = await fetch(`${API_BASE}/api/auth/passkeys?id=${id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${sessionId}` }
      });
      const data = await res.json() as ApiResponse<{ deleted: boolean }>;
      if (!data.success) {
        throw new Error(data.error || 'Failed to delete passkey');
      }
      await loadPasskeys();
    } catch (error: any) {
      setSettingsError(error.message || 'Failed to delete passkey');
    } finally {
      setDeletingPasskeyId(null);
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
    initialLoadDoneRef.current = false; // Reset for next login
  };

  // Helper to get admin auth headers (works with both admin and superadmin tokens)
  const getAdminHeaders = (): Record<string, string> => {
    if (adminToken) return { 'X-Admin-Token': adminToken };
    if (superadminToken) return { 'X-Superadmin-Token': superadminToken };
    return {};
  };

  // Check if we have any admin auth
  const hasAdminAuth = adminToken || superadminToken;

  // Fetch canton users (for admin view) - only when dropdown is expanded
  const fetchCantonUsers = async () => {
    if (!hasAdminAuth) return;
    if (cantonUsers.length > 0) return; // Already loaded
    setPartiesLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/auth/users`, {
        headers: getAdminHeaders()
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

  // Fetch balances from blockchain RPCs (native tokens and contract tokens)
  const fetchChainBalances = async (
    walletAddresses: Array<{ chainType: string; address: string }>,
    assetsList: Asset[],
    network: 'mainnet' | 'testnet' = 'mainnet'
  ) => {
    const balances: Record<string, number> = {};

    // Network mappings
    const evmChainId = network === 'mainnet' ? 1 : 11155111; // Ethereum mainnet vs Sepolia
    const evmBaseChainId = network === 'mainnet' ? 8453 : 11155111; // Base mainnet vs Sepolia
    const btcNetwork = network === 'mainnet' ? 'mainnet' : 'testnet';
    const solNetwork = network === 'mainnet' ? 'mainnet' : 'devnet';
    const tronNetwork = network === 'mainnet' ? 'mainnet' : 'shasta';
    const tonNetwork = network === 'mainnet' ? 'mainnet' : 'testnet';

    // Fetch native token balances
    const nativeBalancePromises = walletAddresses.map(async (wallet) => {
      try {
        switch (wallet.chainType) {
          case 'evm': {
            // Fetch ETH balance on Ethereum
            const ethBalance = await evmSigner.getBalance(wallet.address, evmChainId);
            balances['ETH'] = Number(ethBalance) / 1e18;
            balances['ETH_Ethereum'] = Number(ethBalance) / 1e18;
            // Fetch ETH balance on Base (multi-chain ETH)
            if (network === 'mainnet') {
              const baseBalance = await evmSigner.getBalance(wallet.address, evmBaseChainId);
              balances['ETH_Base'] = Number(baseBalance) / 1e18;
            }
            break;
          }
          case 'btc': {
            const btcBalance = await btcSigner.getBalance(wallet.address, btcNetwork as 'mainnet' | 'testnet');
            balances['BTC'] = btcBalance / 1e8; // satoshis to BTC
            break;
          }
          case 'svm': {
            const solBalance = await solSigner.getBalance(wallet.address, solNetwork as 'mainnet' | 'devnet');
            balances['SOL'] = solBalance / 1e9; // lamports to SOL
            break;
          }
          case 'tron': {
            const trxBalance = await tronSigner.getBalance(wallet.address, tronNetwork as 'mainnet' | 'shasta');
            balances['TRX'] = trxBalance / 1e6; // SUN to TRX
            break;
          }
          case 'ton': {
            const tonBalance = await tonSigner.getBalance(wallet.address, tonNetwork as 'mainnet' | 'testnet');
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
              // ERC20 token balance - use network-appropriate chain ID
              const chainId = network === 'mainnet'
                ? (chain.chain === 'Base' ? 8453 : 1)
                : 11155111; // Sepolia for testnet
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
                solNetwork as 'mainnet' | 'devnet'
              );
            } else if (chain.chainType === 'tron') {
              // TRC20 token balance (Tron)
              tokenBalance = await tronSigner.getTokenBalance(
                chain.contractAddress!,
                wallet.address,
                tronNetwork as 'mainnet' | 'shasta'
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

  const loadWalletData = async (force = false, networkModeOverride?: 'mainnet' | 'testnet') => {
    if (!authUser) return;

    // Prevent concurrent calls (React StrictMode double-invokes in dev)
    if (loadingWalletRef.current) return;

    // Throttle: prevent calls within 2 seconds unless forced
    const now = Date.now();
    if (!force && now - lastLoadTimeRef.current < 2000) return;

    loadingWalletRef.current = true;
    lastLoadTimeRef.current = now;

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
      const txData = await txRes.json() as TransactionsApiResponse;
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
          { symbol: 'ETH', name: 'Ethereum', balance: 0, icon: 'Ξ', chain: 'Ethereum', chainType: 'evm', chains: [
            { chain: 'Ethereum', chainType: 'evm', contractAddress: null, decimals: 18 },
            { chain: 'Base', chainType: 'evm', contractAddress: null, decimals: 18 }
          ]},
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

      // Notify iframe apps that assets have changed
      walletBridgeRef.current?.notifyAssetsChanged();

      if (txData.success && txData.data) {
        setTransactions(txData.data);
        if (txData.pagination) {
          setTransactionPagination(txData.pagination);
        }
      } else {
        setTransactions([]);
        setTransactionPagination(null);
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
          const chainBalances = await fetchChainBalances(infoData.data.walletAddresses, assetsList, networkModeOverride || networkMode);

          // Update asset balances with RPC data
          setAssets(prevAssets => prevAssets.map(asset => {
            let newBalance = asset.balance;
            const perChainBalances: Record<string, number> = {};

            // Check for multi-chain token balances (e.g., USDC_Ethereum, USDC_Base, ETH_Ethereum, ETH_Base)
            if (asset.chains && asset.chains.length > 1) {
              // Sum up balances across all chains for multi-chain assets
              let totalBalance = 0;
              let foundChainBalances = false;
              for (const chain of asset.chains) {
                const chainKey = `${asset.symbol}_${chain.chain}`;
                if (chainBalances[chainKey] !== undefined) {
                  perChainBalances[chain.chain] = chainBalances[chainKey];
                  totalBalance += chainBalances[chainKey];
                  foundChainBalances = true;
                }
              }
              // Only fall back to native balance key if no per-chain balances found
              if (!foundChainBalances && chainBalances[asset.symbol] !== undefined) {
                totalBalance = chainBalances[asset.symbol];
              }
              if (totalBalance > 0) {
                newBalance = totalBalance;
              }
            } else {
              // Single-chain asset - check direct symbol match
              if (chainBalances[asset.symbol] !== undefined) {
                newBalance = chainBalances[asset.symbol];
                // Store single chain balance
                if (asset.chain) {
                  perChainBalances[asset.chain] = chainBalances[asset.symbol];
                }
              }
            }

            return {
              ...asset,
              balance: newBalance,
              chainBalances: Object.keys(perChainBalances).length > 0 ? perChainBalances : undefined
            };
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
        const newTxData = await newTxRes.json() as TransactionsApiResponse;
        if (newBalanceData.success && newBalanceData.data) {
          // Update CC balance in assets
          setAssets(prev => prev.map(a =>
            a.symbol === 'CC' ? { ...a, balance: newBalanceData.data!.total } : a
          ));
        }
        if (newTxData.success && newTxData.data) {
          setTransactions(newTxData.data);
          if (newTxData.pagination) {
            setTransactionPagination(newTxData.pagination);
          }
        }
      } else {
        setTransferOffers([]);
      }
      // Sync transactions from external chains in background (non-blocking)
      // Only sync on manual refresh (force=true), not on initial load
      if (force) {
        fetch(`${API_BASE}/api/wallet/sync-transactions`, {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({ network: networkModeOverride || networkMode })
        }).then(async (syncRes) => {
          if (syncRes.ok) {
            const syncData = await syncRes.json() as { success: boolean; data?: { totalRecorded: number } };
            if (syncData.success && syncData.data?.totalRecorded && syncData.data.totalRecorded > 0) {
              console.log(`Synced ${syncData.data.totalRecorded} new transactions from external chains`);
              // Refresh transactions after sync
              const refreshRes = await fetch(`${API_BASE}/api/wallet/transactions`, { headers });
              const refreshData = await refreshRes.json() as TransactionsApiResponse;
              if (refreshData.success && refreshData.data) {
                setTransactions(refreshData.data);
                if (refreshData.pagination) {
                  setTransactionPagination(refreshData.pagination);
                }
              }
            }
          }
        }).catch(err => console.warn('Transaction sync failed:', err));
      }
    } catch (error) {
      console.error('Error loading wallet data:', error);
      setAssets([{ symbol: 'CC', name: 'Canton Coin', balance: 0, icon: '◈', chain: 'Canton' }]);
      setTransactions([]);
      setTransferOffers([]);
      setChainAddresses([]);
    } finally {
      setLoading(false);
      loadingWalletRef.current = false;
      initialLoadDoneRef.current = true; // Mark initial load as complete
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
        loadWalletData(true);
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
        loadWalletData(true);
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
        loadWalletData(true);
      }
    } catch (error) {
      console.error('Failed to delete custom asset:', error);
    }
  };

  const handleCreateParty = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!hasAdminAuth) return;
    setCreateUserStatus('Creating party...');

    try {
      const response = await fetch(`${API_BASE}/api/admin/users`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...getAdminHeaders()
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
    if (!hasAdminAuth) return;
    setAdminLoading(true);
    setSuperadminError('');
    try {
      const res = await fetch(`${API_BASE}/api/admin/db-users`, { headers: getAdminHeaders() });
      const data = await res.json() as ApiResponse<DbUser[]> & { nodeName?: string };
      if (data.success && data.data) {
        setDbUsers(data.data);
        if (data.nodeName) {
          setNodeName(data.nodeName);
        }
      } else {
        setSuperadminError(data.error || 'Failed to fetch users');
      }
    } catch (error) {
      setSuperadminError('Failed to fetch users');
      console.error('Error fetching db users:', error);
    } finally {
      setAdminLoading(false);
    }
  };


  const handleDeleteUser = async (userId: string) => {
    if (!hasAdminAuth) return;
    if (!confirm('Are you sure you want to delete this user? This action cannot be undone.')) {
      return;
    }
    try {
      const res = await fetch(`${API_BASE}/api/admin/db-users/${userId}`, {
        method: 'DELETE',
        headers: getAdminHeaders()
      });
      const data = await res.json() as ApiResponse;
      if (data.success) {
        await fetchDbUsers();
      } else {
        setSuperadminError(data.error || 'Failed to delete user');
      }
    } catch (error) {
      setSuperadminError('Failed to delete user');
      console.error('Error deleting user:', error);
    }
  };

  const handleAdminTapFaucet = async (username: string) => {
    if (!hasAdminAuth) return;
    const setError = superadminToken ? setSuperadminError : setSuperadminError;
    setError('');
    try {
      const res = await fetch(`${API_BASE}/api/wallet/tap`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Wallet-User': username,
          ...getAdminHeaders()
        },
        body: JSON.stringify({ amount: '100.0' })
      });
      const data = await res.json() as ApiResponse;
      if (data.success) {
        setError(`Faucet tapped! 100 CC added to ${username}`);
        setTimeout(() => setError(''), 3000);
      } else {
        setError(`Faucet error: ${data.error}`);
      }
    } catch (error) {
      setError(`Faucet error: ${error}`);
      console.error('Error tapping faucet:', error);
    }
  };

  // Registration codes functions
  const fetchRegistrationCodes = async () => {
    if (!hasAdminAuth) return;
    setRegCodesLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/admin/registration-codes`, {
        headers: getAdminHeaders()
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
    if (!hasAdminAuth) return;
    setCreateCodeStatus('');
    try {
      const res = await fetch(`${API_BASE}/api/admin/registration-codes`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...getAdminHeaders()
        },
        body: JSON.stringify({
          maxUses: newCodeType === 'reserved_username' ? 1 : (parseInt(newCodeMaxUses) || 10),
          expiresAt: newCodeExpiry || undefined,
          codeType: newCodeType,
          reservedUsername: newCodeType === 'reserved_username' ? newCodeReservedUsername : undefined
        })
      });
      const data = await res.json() as ApiResponse<{ code: string }>;
      if (data.success && data.data) {
        setCreateCodeStatus(`Created code: ${data.data.code}`);
        setNewCodeMaxUses('10');
        setNewCodeExpiry('');
        setNewCodeType('general');
        setNewCodeReservedUsername('');
        fetchRegistrationCodes();
      } else {
        setCreateCodeStatus(`Error: ${data.error}`);
      }
    } catch (error) {
      setCreateCodeStatus(`Error: ${error}`);
    }
  };

  const handleDeleteCode = async (codeId: string) => {
    if (!hasAdminAuth || !confirm('Delete this registration code?')) return;
    try {
      const res = await fetch(`${API_BASE}/api/admin/registration-codes/${codeId}`, {
        method: 'DELETE',
        headers: getAdminHeaders()
      });
      const data = await res.json() as ApiResponse;
      if (data.success) {
        fetchRegistrationCodes();
      } else {
        setSuperadminError(data.error || 'Failed to delete code');
      }
    } catch (error) {
      setSuperadminError('Failed to delete code');
    }
  };

  const copyCodeUrl = (code: string) => {
    const url = `${window.location.origin}?code=${code}`;
    navigator.clipboard.writeText(url);
    setSuperadminError('Registration URL copied to clipboard!');
    setTimeout(() => setSuperadminError(''), 2000);
  };

  // DAR upload functions
  const fetchPackages = async () => {
    if (!hasAdminAuth) return;
    setPackagesLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/admin/dar`, {
        headers: getAdminHeaders()
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

  const handleDarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!hasAdminAuth || !e.target.files || e.target.files.length === 0) return;

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
        headers: getAdminHeaders(),
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

  const handleDarInstallFromUrl = async () => {
    if (!hasAdminAuth || !darInstallUrl.trim()) return;

    // Validate URL format
    let baseUrl: string;
    try {
      const parsed = new URL(darInstallUrl.trim());
      baseUrl = parsed.origin;
    } catch {
      setDarUploadStatus('Error: Invalid URL format');
      return;
    }

    setDarUploading(true);
    setDarUploadStatus('Fetching package info...');

    try {
      // First fetch package info from the app's /api/package endpoint
      const packageInfoRes = await fetch(`${baseUrl}/api/package`);
      if (!packageInfoRes.ok) {
        setDarUploadStatus(`Error: Could not fetch package info from ${baseUrl}/api/package`);
        setDarUploading(false);
        return;
      }

      const packageInfo = await packageInfoRes.json() as {
        name?: string;
        packageId?: string | null;
        darUrl?: string;
      };

      if (!packageInfo.darUrl) {
        setDarUploadStatus('Error: No darUrl found in package info');
        setDarUploading(false);
        return;
      }

      setDarUploadStatus(`Installing ${packageInfo.name || 'package'}...`);

      // Now install using the darUrl
      const res = await fetch(`${API_BASE}/api/admin/dar`, {
        method: 'POST',
        headers: {
          ...getAdminHeaders(),
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ darUrl: packageInfo.darUrl })
      });

      const data = await res.json() as ApiResponse<{ mainPackageId: string; darName: string; size: number }>;
      if (data.success && data.data) {
        setDarUploadStatus(`Installed: ${data.data.darName} (Package: ${data.data.mainPackageId.substring(0, 16)}...)`);
        fetchPackages(); // Refresh package list
        setShowInstallFromUrl(false);
        setDarInstallUrl('');
      } else {
        setDarUploadStatus(`Error: ${data.error}`);
      }
    } catch (error) {
      setDarUploadStatus(`Error: ${error instanceof Error ? error.message : 'Install failed'}`);
    } finally {
      setDarUploading(false);
    }
  };

  // Check and install package for a docked app if needed
  const checkAndInstallAppPackage = async (appId: string, appUrl: string): Promise<boolean> => {
    if (!hasAdminAuth) {
      // Non-admin users can't install packages, just proceed
      return true;
    }

    // Skip if already checking or ready
    const currentStatus = appPackageStatus[appId];
    if (currentStatus?.status === 'checking' || currentStatus?.status === 'installing') {
      return false; // Still in progress
    }
    if (currentStatus?.status === 'ready') {
      return true; // Already verified
    }

    setAppPackageStatus(prev => ({ ...prev, [appId]: { status: 'checking', message: 'Checking package...' } }));

    try {
      // Fetch package info from the app
      const packageInfoRes = await fetch(`${appUrl}/api/package`);
      if (!packageInfoRes.ok) {
        // App doesn't have /api/package endpoint, proceed anyway
        setAppPackageStatus(prev => ({ ...prev, [appId]: { status: 'ready' } }));
        return true;
      }

      const packageInfo = await packageInfoRes.json() as {
        name?: string;
        packageId?: string | null;
        darUrl?: string;
        templates?: string[];
      };

      // If no packageId specified, proceed
      if (!packageInfo.packageId || !packageInfo.darUrl) {
        setAppPackageStatus(prev => ({ ...prev, [appId]: { status: 'ready' } }));
        return true;
      }

      // Check if package is already installed
      const packagesRes = await fetch(`${API_BASE}/api/admin/dar`, {
        headers: getAdminHeaders()
      });
      const packagesData = await packagesRes.json() as ApiResponse<{ packageIds: string[] }>;

      if (packagesData.success && packagesData.data?.packageIds?.includes(packageInfo.packageId)) {
        // Package already installed
        setAppPackageStatus(prev => ({ ...prev, [appId]: { status: 'ready' } }));
        return true;
      }

      // Need to install the package
      setAppPackageStatus(prev => ({
        ...prev,
        [appId]: { status: 'installing', message: `Installing ${packageInfo.name || 'package'}...` }
      }));

      const installRes = await fetch(`${API_BASE}/api/admin/dar`, {
        method: 'POST',
        headers: {
          ...getAdminHeaders(),
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ darUrl: packageInfo.darUrl })
      });

      const installData = await installRes.json() as ApiResponse<{ mainPackageId: string }>;

      if (installData.success) {
        setAppPackageStatus(prev => ({ ...prev, [appId]: { status: 'ready' } }));
        fetchPackages(); // Refresh package list
        return true;
      } else {
        setAppPackageStatus(prev => ({
          ...prev,
          [appId]: { status: 'error', message: installData.error || 'Installation failed' }
        }));
        return false;
      }
    } catch (error) {
      setAppPackageStatus(prev => ({
        ...prev,
        [appId]: { status: 'error', message: error instanceof Error ? error.message : 'Check failed' }
      }));
      return false;
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
        const data = await res.json() as ApiResponse<{ valid: boolean; reason?: string; usesRemaining?: number; codeType?: string; reservedUsername?: string | null }>;
        if (data.success && data.data) {
          setCodeValidation({ ...data.data, checked: true });
          if (data.data.codeType === 'reserved_username' && data.data.reservedUsername) {
            setLoginUsername(data.data.reservedUsername);
          }
        } else {
          setCodeValidation({ valid: false, reason: 'error', checked: true });
        }
      } catch (error) {
        setCodeValidation({ valid: false, reason: 'error', checked: true });
      }
    };
    validateCode();
  }, [registrationCode]);

  // Superadmin functions
  const fetchSuperadminSession = async () => {
    if (!superadminToken) return;
    try {
      const res = await fetch(`${API_BASE}/api/superadmin/verify`, {
        headers: { 'X-Superadmin-Token': superadminToken }
      });
      const data = await res.json() as ApiResponse<{ user: SuperadminUser }>;
      if (data.success && data.data?.user) {
        setSuperadminUser(data.data.user);
      } else {
        localStorage.removeItem('superadminToken');
        setSuperadminToken(null);
        setSuperadminUser(null);
      }
    } catch {
      localStorage.removeItem('superadminToken');
      setSuperadminToken(null);
    }
  };

  const fetchAdminUsers = async () => {
    if (!superadminToken) return;
    try {
      const res = await fetch(`${API_BASE}/api/superadmin/users`, {
        headers: { 'X-Superadmin-Token': superadminToken }
      });
      const data = await res.json() as ApiResponse<AdminUserRow[]>;
      if (data.success && data.data) {
        setAdminUsers(data.data);
      }
    } catch (error) {
      console.error('Failed to fetch admin users:', error);
    }
  };

  const fetchSuperadminConfig = async () => {
    if (!superadminToken) return;
    try {
      const res = await fetch(`${API_BASE}/api/superadmin/config`, {
        headers: { 'X-Superadmin-Token': superadminToken }
      });
      const data = await res.json() as ApiResponse<{ config: ConfigData; cantonVersion?: string; boundServices?: Record<string, string> }>;
      if (data.success && data.data) {
        setConfigData(data.data.config);
        if (data.data.cantonVersion) {
          setCantonVersion(data.data.cantonVersion);
        }
        if (data.data.boundServices) {
          setBoundServices(data.data.boundServices);
        }
      }
    } catch (error) {
      console.error('Failed to fetch config:', error);
    }
  };

  const fetchRpcEndpoints = async () => {
    if (!superadminToken) return;
    setRpcLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/superadmin/rpc`, {
        headers: { 'X-Superadmin-Token': superadminToken }
      });
      const data = await res.json() as ApiResponse<RpcEndpointRow[]>;
      if (data.success && data.data) {
        setRpcEndpoints(data.data);
      }
    } catch (error) {
      console.error('Failed to fetch RPC endpoints:', error);
    } finally {
      setRpcLoading(false);
    }
  };

  const fetchAvailableChains = async () => {
    if (!superadminToken) return;
    try {
      const res = await fetch(`${API_BASE}/api/superadmin/rpc/chains`, {
        headers: { 'X-Superadmin-Token': superadminToken }
      });
      const data = await res.json() as ApiResponse<Array<{ chain: string; chain_type: string; chain_id: string | null; network: string }>>;
      if (data.success && data.data) {
        setAvailableChains(data.data);
      }
    } catch (error) {
      console.error('Failed to fetch available chains:', error);
    }
  };

  const handleAddRpc = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!superadminToken) return;
    try {
      const res = await fetch(`${API_BASE}/api/superadmin/rpc`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Superadmin-Token': superadminToken
        },
        body: JSON.stringify(newRpc)
      });
      const data = await res.json() as ApiResponse<RpcEndpointRow>;
      if (data.success) {
        setShowAddRpc(false);
        setNewRpc({ chain_type: 'evm', chain_name: 'Ethereum', chain_id: '1', network: 'mainnet', name: '', rpc_url: '', priority: 0, is_enabled: true });
        fetchRpcEndpoints();
      } else {
        alert(data.error || 'Failed to add RPC endpoint');
      }
    } catch (error) {
      console.error('Failed to add RPC endpoint:', error);
    }
  };

  const handleUpdateRpc = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!superadminToken || !editingRpc) return;
    try {
      const res = await fetch(`${API_BASE}/api/superadmin/rpc?id=${editingRpc.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'X-Superadmin-Token': superadminToken
        },
        body: JSON.stringify({
          chain_type: editingRpc.chain_type,
          chain_name: editingRpc.chain_name,
          chain_id: editingRpc.chain_id,
          network: editingRpc.network,
          name: editingRpc.name,
          rpc_url: editingRpc.rpc_url,
          priority: editingRpc.priority,
          is_enabled: editingRpc.is_enabled === 1
        })
      });
      const data = await res.json() as ApiResponse<RpcEndpointRow>;
      if (data.success) {
        setEditingRpc(null);
        fetchRpcEndpoints();
      } else {
        alert(data.error || 'Failed to update RPC endpoint');
      }
    } catch (error) {
      console.error('Failed to update RPC endpoint:', error);
    }
  };

  const handleDeleteRpc = async (id: string) => {
    if (!superadminToken) return;
    if (!confirm('Are you sure you want to delete this RPC endpoint?')) return;
    try {
      const res = await fetch(`${API_BASE}/api/superadmin/rpc?id=${id}`, {
        method: 'DELETE',
        headers: { 'X-Superadmin-Token': superadminToken }
      });
      const data = await res.json() as ApiResponse;
      if (data.success) {
        fetchRpcEndpoints();
      } else {
        alert(data.error || 'Failed to delete RPC endpoint');
      }
    } catch (error) {
      console.error('Failed to delete RPC endpoint:', error);
    }
  };

  const handleToggleRpcEnabled = async (endpoint: RpcEndpointRow) => {
    if (!superadminToken) return;
    try {
      const res = await fetch(`${API_BASE}/api/superadmin/rpc?id=${endpoint.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'X-Superadmin-Token': superadminToken
        },
        body: JSON.stringify({ is_enabled: endpoint.is_enabled === 0 })
      });
      const data = await res.json() as ApiResponse<RpcEndpointRow>;
      if (data.success) {
        fetchRpcEndpoints();
      }
    } catch (error) {
      console.error('Failed to toggle RPC endpoint:', error);
    }
  };

  const fetchApps = async () => {
    if (!superadminToken) return;
    setAppsLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/superadmin/apps`, {
        headers: { 'X-Superadmin-Token': superadminToken }
      });
      const data = await res.json() as ApiResponse<AppRow[]>;
      if (data.success && data.data) {
        setAppsList(data.data);
        // Check package status for all apps with URLs
        checkAllAppsPackageStatus(data.data);
      }
    } catch (error) {
      console.error('Failed to fetch apps:', error);
    } finally {
      setAppsLoading(false);
    }
  };

  // Check package installation status for all apps
  const checkAllAppsPackageStatus = async (apps: AppRow[]) => {
    if (!hasAdminAuth) return;

    // Get the list of installed packages
    let installedPackages: string[] = [];
    try {
      const packagesRes = await fetch(`${API_BASE}/api/admin/dar`, {
        headers: getAdminHeaders()
      });
      const packagesData = await packagesRes.json() as ApiResponse<{ packageIds: string[] }>;
      if (packagesData.success && packagesData.data?.packageIds) {
        installedPackages = packagesData.data.packageIds;
      }
    } catch (error) {
      console.error('Failed to fetch installed packages:', error);
      return;
    }

    // Check each app with a URL
    for (const app of apps) {
      if (!app.url) continue;

      // Skip if already checked
      const currentStatus = appPackageStatus[app.id];
      if (currentStatus?.status === 'ready' || currentStatus?.status === 'checking') continue;

      try {
        setAppPackageStatus(prev => ({ ...prev, [app.id]: { status: 'checking', message: 'Checking...' } }));

        const packageInfoRes = await fetch(`${app.url}/api/package`);
        if (!packageInfoRes.ok) {
          // App doesn't have /api/package endpoint - mark as N/A
          setAppPackageStatus(prev => ({ ...prev, [app.id]: { status: 'na', message: 'No package endpoint' } }));
          continue;
        }

        const packageInfo = await packageInfoRes.json() as {
          name?: string;
          packageId?: string | null;
          darUrl?: string;
        };

        if (!packageInfo.packageId) {
          // No package ID specified
          setAppPackageStatus(prev => ({ ...prev, [app.id]: { status: 'na', message: 'No package required' } }));
          continue;
        }

        // Check if installed
        if (installedPackages.includes(packageInfo.packageId)) {
          setAppPackageStatus(prev => ({ ...prev, [app.id]: { status: 'ready', message: 'Installed' } }));
        } else {
          setAppPackageStatus(prev => ({ ...prev, [app.id]: { status: 'not_installed', message: 'Not installed' } }));
        }
      } catch (error) {
        setAppPackageStatus(prev => ({
          ...prev,
          [app.id]: { status: 'error', message: 'Failed to check' }
        }));
      }
    }
  };

  const handleAddApp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!superadminToken) return;
    try {
      const res = await fetch(`${API_BASE}/api/superadmin/apps`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Superadmin-Token': superadminToken
        },
        body: JSON.stringify({
          id: newApp.id || undefined,
          name: newApp.name,
          icon: newApp.icon,
          color: newApp.color,
          url: newApp.url || null,
          sort_order: newApp.sort_order,
          is_enabled: newApp.is_enabled
        })
      });
      const data = await res.json() as ApiResponse<AppRow>;
      if (data.success) {
        setShowAddApp(false);
        setNewApp({ id: '', name: '', icon: '', color: '#6366f1', url: '', sort_order: 0, is_enabled: true });
        fetchApps();
      } else {
        alert(data.error || 'Failed to add app');
      }
    } catch (error) {
      console.error('Failed to add app:', error);
    }
  };

  const handleUpdateApp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!superadminToken || !editingApp) return;
    try {
      const res = await fetch(`${API_BASE}/api/superadmin/apps?id=${editingApp.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'X-Superadmin-Token': superadminToken
        },
        body: JSON.stringify({
          name: editingApp.name,
          icon: editingApp.icon,
          color: editingApp.color,
          url: editingApp.url,
          sort_order: editingApp.sort_order,
          is_enabled: editingApp.is_enabled === 1
        })
      });
      const data = await res.json() as ApiResponse<AppRow>;
      if (data.success) {
        setEditingApp(null);
        fetchApps();
      } else {
        alert(data.error || 'Failed to update app');
      }
    } catch (error) {
      console.error('Failed to update app:', error);
    }
  };

  const handleDeleteApp = async (id: string) => {
    if (!superadminToken) return;
    if (!confirm('Are you sure you want to delete this app?')) return;
    try {
      const res = await fetch(`${API_BASE}/api/superadmin/apps?id=${id}`, {
        method: 'DELETE',
        headers: { 'X-Superadmin-Token': superadminToken }
      });
      const data = await res.json() as ApiResponse;
      if (data.success) {
        fetchApps();
      } else {
        alert(data.error || 'Failed to delete app');
      }
    } catch (error) {
      console.error('Failed to delete app:', error);
    }
  };

  const handleToggleAppEnabled = async (app: AppRow) => {
    if (!superadminToken) return;
    try {
      const res = await fetch(`${API_BASE}/api/superadmin/apps?id=${app.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'X-Superadmin-Token': superadminToken
        },
        body: JSON.stringify({ is_enabled: app.is_enabled === 0 })
      });
      const data = await res.json() as ApiResponse<AppRow>;
      if (data.success) {
        fetchApps();
      }
    } catch (error) {
      console.error('Failed to toggle app:', error);
    }
  };

  // App access control functions
  const fetchAppAccess = async () => {
    if (!superadminToken) return;
    try {
      const res = await fetch(`${API_BASE}/api/superadmin/app-access`, {
        headers: { 'X-Superadmin-Token': superadminToken }
      });
      const data = await res.json() as ApiResponse<Array<{ user_id: string; app_id: string; username: string; display_name: string | null }>>;
      if (data.success && data.data) {
        const map: Record<string, string[]> = {};
        const users: Record<string, AppAccessUser[]> = {};
        data.data.forEach((row) => {
          if (!map[row.app_id]) map[row.app_id] = [];
          map[row.app_id].push(row.user_id);
          if (!users[row.app_id]) users[row.app_id] = [];
          users[row.app_id].push({ user_id: row.user_id, username: row.username, display_name: row.display_name });
        });
        setAppAccessMap(map);
        setAppAccessUsers(users);
      }
    } catch (error) {
      console.error('Failed to fetch app access:', error);
    }
  };

  const handleGrantAppAccess = async (userId: string, appId: string) => {
    if (!superadminToken) return;
    try {
      const res = await fetch(`${API_BASE}/api/superadmin/app-access`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Superadmin-Token': superadminToken
        },
        body: JSON.stringify({ user_id: userId, app_id: appId })
      });
      const data = await res.json() as ApiResponse;
      if (data.success) {
        fetchAppAccess();
      }
    } catch (error) {
      console.error('Failed to grant app access:', error);
    }
  };

  const handleRevokeAppAccess = async (userId: string, appId: string) => {
    if (!superadminToken) return;
    try {
      const res = await fetch(`${API_BASE}/api/superadmin/app-access?user_id=${userId}&app_id=${appId}`, {
        method: 'DELETE',
        headers: { 'X-Superadmin-Token': superadminToken }
      });
      const data = await res.json() as ApiResponse;
      if (data.success) {
        fetchAppAccess();
      }
    } catch (error) {
      console.error('Failed to revoke app access:', error);
    }
  };

  const handleSuperadminLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setSuperadminLoading(true);
    setSuperadminError('');

    try {
      const res = await fetch(`${API_BASE}/api/superadmin/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: superadminUsername, password: superadminPassword })
      });
      const data = await res.json() as ApiResponse<{ token: string; user: SuperadminUser }>;

      if (data.success && data.data?.token) {
        localStorage.setItem('superadminToken', data.data.token);
        setSuperadminToken(data.data.token);
        setSuperadminUser(data.data.user);
        setSuperadminUsername('');
        setSuperadminPassword('');
        fetchAdminUsers();
        fetchSuperadminConfig();
      } else {
        setSuperadminError(data.error || 'Login failed');
      }
    } catch (error) {
      setSuperadminError('Login failed');
      console.error('Superadmin login error:', error);
    } finally {
      setSuperadminLoading(false);
    }
  };

  const handleSuperadminLogout = async () => {
    if (superadminToken) {
      try {
        await fetch(`${API_BASE}/api/superadmin/logout`, {
          method: 'POST',
          headers: { 'X-Superadmin-Token': superadminToken }
        });
      } catch {}
    }
    localStorage.removeItem('superadminToken');
    setSuperadminToken(null);
    setSuperadminUser(null);
    setAdminUsers([]);
    setConfigData(null);
  };

  const handleCreateAdminUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!superadminToken) return;
    setSuperadminError('');

    try {
      const res = await fetch(`${API_BASE}/api/superadmin/users`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Superadmin-Token': superadminToken
        },
        body: JSON.stringify({
          username: newAdminUsername,
          password: newAdminPassword,
          displayName: newAdminDisplayName || undefined,
          isSuperadmin: newAdminIsSuperadmin
        })
      });
      const data = await res.json() as ApiResponse<AdminUserRow>;

      if (data.success) {
        setShowCreateAdminUser(false);
        setNewAdminUsername('');
        setNewAdminPassword('');
        setNewAdminDisplayName('');
        setNewAdminIsSuperadmin(false);
        fetchAdminUsers();
      } else {
        setSuperadminError(data.error || 'Failed to create user');
      }
    } catch (error) {
      setSuperadminError('Failed to create user');
    }
  };

  const handleDeleteAdminUser = async (userId: string) => {
    if (!superadminToken) return;
    if (!confirm('Are you sure you want to delete this admin user?')) return;

    try {
      const res = await fetch(`${API_BASE}/api/superadmin/users/${userId}`, {
        method: 'DELETE',
        headers: { 'X-Superadmin-Token': superadminToken }
      });
      const data = await res.json() as ApiResponse<void>;

      if (data.success) {
        fetchAdminUsers();
      } else {
        setSuperadminError(data.error || 'Failed to delete user');
      }
    } catch (error) {
      setSuperadminError('Failed to delete user');
    }
  };

  const handleToggleSuperadmin = async (userId: string, currentValue: boolean) => {
    if (!superadminToken) return;

    try {
      const res = await fetch(`${API_BASE}/api/superadmin/users/${userId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'X-Superadmin-Token': superadminToken
        },
        body: JSON.stringify({ isSuperadmin: !currentValue })
      });
      const data = await res.json() as ApiResponse<AdminUserRow>;

      if (data.success) {
        fetchAdminUsers();
      } else {
        setSuperadminError(data.error || 'Failed to update user');
      }
    } catch (error) {
      setSuperadminError('Failed to update user');
    }
  };

  const handleSaveConfig = async () => {
    if (!superadminToken || !editConfigData) return;
    setSuperadminError('');

    try {
      const res = await fetch(`${API_BASE}/api/superadmin/config`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'X-Superadmin-Token': superadminToken
        },
        body: JSON.stringify(editConfigData)
      });
      const data = await res.json() as ApiResponse<{ config: ConfigData }>;

      if (data.success && data.data) {
        setConfigData(data.data.config);
        setEditingConfig(false);
        setEditConfigData(null);
        // Refresh the page config
        window.location.reload();
      } else {
        setSuperadminError(data.error || 'Failed to save configuration');
      }
    } catch (error) {
      setSuperadminError('Failed to save configuration');
    }
  };

  // Load admin data when entering admin view
  useEffect(() => {
    if (currentView === 'admin' && superadminToken) {
      fetchSuperadminSession();
      fetchAdminUsers();
      fetchSuperadminConfig();
    }
  }, [currentView, superadminToken]);

  // Load section-specific data when switching sections in admin
  useEffect(() => {
    if (currentView !== 'admin' || !superadminToken) return;

    switch (superadminSection) {
      case 'admin-users':
        fetchAdminUsers();
        break;
      case 'config':
        fetchSuperadminConfig();
        break;
      case 'users':
        fetchDbUsers();
        break;
      case 'codes':
        fetchRegistrationCodes();
        break;
      case 'rpc':
        fetchRpcEndpoints();
        fetchAvailableChains();
        break;
      case 'apps':
        fetchApps();
        fetchAppAccess();
        if (dbUsers.length === 0) fetchDbUsers();
        break;
    }
  }, [superadminSection, superadminToken, currentView]);

  // Emoji picker grid
  const EMOJI_OPTIONS = [
    '🚀', '💰', '🏦', '💎', '🔗', '⚡', '🌐', '📊',
    '💱', '🔒', '🛡️', '📈', '📉', '💸', '🪙', '🏧',
    '🔄', '⇄', '🖼', '📋', '⚙️', '🔧', '🛒', '🎮',
    '📱', '💬', '📁', '📂', '🗂️', '🔍', '📝', '✅',
    '❤️', '⭐', '🔥', '🎯', '🎨', '🌟', '💡', '🔔',
    '🏠', '👤', '👥', '🔑', '📡', '🧩', '📦', '🗄️',
  ];

  const renderEmojiPicker = (target: 'new' | 'edit') => {
    if (emojiPickerTarget !== target) return null;
    return (
      <div className="emoji-picker-grid" onClick={(e) => e.stopPropagation()}>
        {EMOJI_OPTIONS.map((emoji) => (
          <button
            key={emoji}
            type="button"
            className="emoji-picker-item"
            onClick={() => {
              if (target === 'new') {
                setNewApp({...newApp, icon: emoji});
              } else if (editingApp) {
                setEditingApp({...editingApp, icon: emoji});
              }
              setEmojiPickerTarget(null);
            }}
          >
            {emoji}
          </button>
        ))}
      </div>
    );
  };

  // Admin view - requires username/password login
  if (currentView === 'admin') {
    // Show login if not authenticated
    if (!superadminToken || !superadminUser) {
      return (
        <div className={`app theme-${theme}`}>
          <div className="login-container">
            <div className="login-card">
              <div className="login-logo">
                <img src={customLogo || '/logo.png'} alt={orgName} />
              </div>
              <h1>Admin</h1>
              <p className="login-subtitle">System administration</p>

              {superadminError && (
                <div className="login-error">{superadminError}</div>
              )}

              <form onSubmit={handleSuperadminLogin}>
                <div className="login-field">
                  <label>Username</label>
                  <input
                    type="text"
                    value={superadminUsername}
                    onChange={(e) => setSuperadminUsername(e.target.value)}
                    placeholder="Enter username"
                    required
                  />
                </div>
                <div className="login-field">
                  <label>Password</label>
                  <input
                    type="password"
                    value={superadminPassword}
                    onChange={(e) => setSuperadminPassword(e.target.value)}
                    placeholder="Enter password"
                    required
                  />
                </div>

                <button type="submit" className="login-btn-primary" disabled={superadminLoading} style={{ marginTop: '0.5rem' }}>
                  {superadminLoading ? 'Authenticating...' : 'Login'}
                </button>
              </form>

              <button onClick={() => navigateTo('wallet')} className="login-btn-ghost">
                Back to Wallet
              </button>
            </div>
          </div>
        </div>
      );
    }

    return (
      <div className={`app theme-${theme}`}>
        <div className="superadmin-layout">
          {/* Left Sidebar */}
          <aside className={`superadmin-sidebar ${adminSidebarCollapsed ? 'collapsed' : ''}`}>
            <div className="sidebar-header">
              <h2>Admin</h2>
              {superadminUser.isSuperadmin && <span className="superadmin-badge">SUPERADMIN</span>}
              <button
                className="sidebar-toggle-btn"
                onClick={() => setAdminSidebarCollapsed(!adminSidebarCollapsed)}
                title={adminSidebarCollapsed ? 'Show navigation' : 'Hide navigation'}
              >
                {adminSidebarCollapsed ? '☰' : '✕'}
              </button>
            </div>

            <nav className="sidebar-nav">
              <button
                className={`sidebar-nav-item ${superadminSection === 'admin-users' ? 'active' : ''}`}
                onClick={() => setSuperadminSection('admin-users')}
              >
                <ShieldCheck size={18} className="nav-icon" />
                <span className="nav-label">Admin Users</span>
                {adminUsers.length > 0 && <span className="nav-badge">{adminUsers.length}</span>}
              </button>

              <button
                className={`sidebar-nav-item ${superadminSection === 'users' ? 'active' : ''}`}
                onClick={() => setSuperadminSection('users')}
              >
                <Users size={18} className="nav-icon" />
                <span className="nav-label">User Management</span>
                {dbUsers.length > 0 && <span className="nav-badge">{dbUsers.length}</span>}
              </button>

              <button
                className={`sidebar-nav-item ${superadminSection === 'codes' ? 'active' : ''}`}
                onClick={() => setSuperadminSection('codes')}
              >
                <KeyRound size={18} className="nav-icon" />
                <span className="nav-label">Registration Codes</span>
                {registrationCodes.length > 0 && <span className="nav-badge">{registrationCodes.length}</span>}
              </button>

              <button
                className={`sidebar-nav-item ${superadminSection === 'rpc' ? 'active' : ''}`}
                onClick={() => setSuperadminSection('rpc')}
              >
                <Globe size={18} className="nav-icon" />
                <span className="nav-label">RPC Endpoints</span>
              </button>

              <button
                className={`sidebar-nav-item ${superadminSection === 'apps' ? 'active' : ''}`}
                onClick={() => setSuperadminSection('apps')}
              >
                <LayoutGrid size={18} className="nav-icon" />
                <span className="nav-label">Apps</span>
              </button>

              <button
                className={`sidebar-nav-item ${superadminSection === 'config' ? 'active' : ''}`}
                onClick={() => setSuperadminSection('config')}
              >
                <Settings size={18} className="nav-icon" />
                <span className="nav-label">Configuration</span>
              </button>
            </nav>

            <div className="sidebar-footer">

              <button onClick={handleSuperadminLogout} className="sidebar-action-btn logout">
                <LogOut size={18} className="nav-icon" />
                Logout
              </button>
            </div>
          </aside>

          {/* Main Content */}
          <main className="superadmin-main">
            {superadminError && (
              <div className={`transfer-status ${superadminError.includes('copied') || superadminError.includes('success') || superadminError.includes('Success') ? 'success' : 'error'}`} style={{ marginBottom: '1rem' }}>
                {superadminError}
              </div>
            )}

            {/* Admin Users Management Section */}
            {superadminSection === 'admin-users' && (
              <section className="admin-card">
                <div className="admin-card-header">
                  <h2>
                    Admin Users
                    {adminUsers.length > 0 && <span className="count-badge">{adminUsers.length}</span>}
                  </h2>
                  {superadminUser.isSuperadmin && (
                    <button
                      onClick={() => setShowCreateAdminUser(true)}
                      className="send-btn admin-btn"
                    >
                      + New Admin
                    </button>
                  )}
                </div>

                <div className="admin-users-table">
                  <div className="admin-table-header">
                    <span>Username</span>
                    <span>Display Name</span>
                    <span>Superadmin</span>
                    <span>Created</span>
                    <span>Actions</span>
                  </div>
                  {adminUsers.length === 0 ? (
                    <div className="no-transactions">No admin users found</div>
                  ) : (
                    adminUsers.map((user) => (
                      <div key={user.id} className="admin-table-row">
                        <span className="admin-cell">{user.username}</span>
                        <span className="admin-cell">{user.displayName || '-'}</span>
                        <span className="admin-cell">
                          {superadminUser.isSuperadmin ? (
                            <label className="toggle-switch">
                              <input
                                type="checkbox"
                                checked={user.isSuperadmin}
                                onChange={() => handleToggleSuperadmin(user.id, user.isSuperadmin)}
                                disabled={user.id === superadminUser.id}
                              />
                              <span className="toggle-slider"></span>
                            </label>
                          ) : (
                            user.isSuperadmin ? 'Yes' : 'No'
                          )}
                        </span>
                        <span className="admin-cell">{new Date(user.createdAt).toLocaleDateString()}</span>
                        <span className="admin-cell">
                          <div className="action-buttons">
                            {superadminUser.isSuperadmin && user.id !== superadminUser.id && (
                              <button
                                onClick={() => handleDeleteAdminUser(user.id)}
                                className="btn-delete"
                              >
                                Delete
                              </button>
                            )}
                          </div>
                        </span>
                      </div>
                    ))
                  )}
                </div>
              </section>
            )}

            {/* Configuration Management Section */}
            {superadminSection === 'config' && (
              <section className="admin-card">
                <div className="admin-card-header">
                  <h2>
                    Configuration
                    
                  </h2>
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    {superadminUser.isSuperadmin && (
                      <button
                        onClick={() => { fetchPackages(); setShowPackagesModal(true); }}
                        className="send-btn admin-btn"
                      >
                        Daml Packages
                      </button>
                    )}
                    {superadminUser.isSuperadmin && configData && !editingConfig && (
                      <button
                        onClick={() => { setEditConfigData({...configData}); setEditingConfig(true); }}
                        className="send-btn admin-btn"
                      >
                        Edit Config
                      </button>
                    )}
                  </div>
                </div>

                {configData && (
                  <div className="section-content">
                    {editingConfig && editConfigData ? (
                  <div className="config-edit-form">
                    <div className="form-group">
                      <label>Organization Name (ORG_NAME)</label>
                      <span className="field-descriptor">Display name shown in the app header and browser title</span>
                      <input
                        type="text"
                        value={editConfigData.ORG_NAME}
                        onChange={(e) => setEditConfigData({...editConfigData, ORG_NAME: e.target.value})}
                      />
                    </div>
                    <div className="form-group">
                      <label>Relying Party Name (RP_NAME)</label>
                      <span className="field-descriptor">Name shown in browser passkey prompts during registration and login</span>
                      <input
                        type="text"
                        value={editConfigData.RP_NAME}
                        onChange={(e) => setEditConfigData({...editConfigData, RP_NAME: e.target.value})}
                      />
                    </div>
                    <div className="form-group">
                      <label>Theme</label>
                      <span className="field-descriptor">Color scheme applied across the entire wallet UI</span>
                      <select
                        value={editConfigData.THEME}
                        onChange={(e) => setEditConfigData({...editConfigData, THEME: e.target.value})}
                        className="role-select"
                      >
                        <option value="purple">Purple</option>
                        <option value="teal">Teal</option>
                        <option value="blue">Blue</option>
                        <option value="green">Green</option>
                        <option value="orange">Orange</option>
                        <option value="rose">Rose</option>
                        <option value="slate">Slate</option>
                        <option value="light">Light</option>
                      </select>
                    </div>
                    <div className="form-group">
                      <label>Splice Host (SPLICE_HOST)</label>
                      <span className="field-descriptor">Canton validator node hostname for ledger API operations</span>
                      <input
                        type="text"
                        value={editConfigData.SPLICE_HOST}
                        onChange={(e) => setEditConfigData({...editConfigData, SPLICE_HOST: e.target.value})}
                      />
                    </div>
                    <div className="form-group">
                      <label>Canton JSON Host (CANTON_JSON_HOST)</label>
                      <span className="field-descriptor">Canton JSON API hostname for party and user management</span>
                      <input
                        type="text"
                        value={editConfigData.CANTON_JSON_HOST}
                        onChange={(e) => setEditConfigData({...editConfigData, CANTON_JSON_HOST: e.target.value})}
                      />
                    </div>
                    <div className="form-group">
                      <label>Chat Agent Webhook URL</label>
                      <span className="field-descriptor">AI assistant webhook endpoint for the chat panel</span>
                      <input
                        type="text"
                        value={editConfigData.CHAT_AGENT_WEBHOOK_URL}
                        onChange={(e) => setEditConfigData({...editConfigData, CHAT_AGENT_WEBHOOK_URL: e.target.value})}
                      />
                    </div>
                    <div className="modal-buttons" style={{ marginTop: '1rem' }}>
                      <button
                        onClick={() => { setEditingConfig(false); setEditConfigData(null); }}
                        className="refresh-btn"
                      >
                        Cancel
                      </button>
                      <button onClick={handleSaveConfig} className="send-btn admin-btn">
                        Save Configuration
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="config-display">
                    {cantonVersion && (
                      <div className="config-item">
                        <strong>Canton Version:</strong>
                        <span>{cantonVersion}</span>
                      </div>
                    )}
                    <div className="config-item">
                      <strong>Organization Name:</strong>
                      <span>{configData.ORG_NAME}</span>
                                            <span className="field-descriptor">Display name shown in the app header and browser title</span>
                    </div>
                    <div className="config-item">
                      <strong>RP Name:</strong>
                      <span>{configData.RP_NAME}</span>
                                            <span className="field-descriptor">Name shown in browser passkey prompts during registration and login</span>
                    </div>
                    <div className="config-item">
                      <strong>Theme:</strong>
                      <span>{configData.THEME}</span>
                                            <span className="field-descriptor">Color scheme applied across the entire wallet UI</span>
                    </div>
                    <div className="config-item">
                      <strong>Splice Host:</strong>
                      <span>{configData.SPLICE_HOST}</span>
                                            <span className="field-descriptor">Canton validator node hostname for ledger API operations</span>
                    </div>
                    <div className="config-item">
                      <strong>Canton JSON Host:</strong>
                      <span>{configData.CANTON_JSON_HOST}</span>
                                            <span className="field-descriptor">Canton JSON API hostname for party and user management</span>
                    </div>
                    <div className="config-item">
                      <strong>Chat Agent Webhook URL:</strong>
                      <span style={{ wordBreak: 'break-all' }}>{configData.CHAT_AGENT_WEBHOOK_URL || 'Not configured'}</span>
                                            <span className="field-descriptor">AI assistant webhook endpoint for the chat panel</span>
                    </div>
                  </div>
                )}

                {/* Logo Management - always visible */}
                <div className="config-display">
                  <div className="config-item" style={{ marginTop: '0.5rem', borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: '0.75rem' }}>
                    <strong style={{ opacity: 0.5, fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Logo</strong>
                  </div>
                  <div className="config-item" style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                    <img src={customLogo || '/logo.png'} alt="Logo" style={{ width: 40, height: 40, borderRadius: 8, background: 'rgba(0,0,0,0.2)' }} />
                    <div style={{ display: 'flex', gap: '0.4rem' }}>
                      <label className="send-btn admin-btn" style={{ cursor: 'pointer', margin: 0 }}>
                        Upload
                        <input
                          type="file"
                          accept="image/png,image/jpeg,image/svg+xml,image/webp"
                          style={{ display: 'none' }}
                          onChange={async (e) => {
                            const file = e.target.files?.[0];
                            if (!file) return;
                            if (file.size > 256 * 1024) {
                              alert('Logo must be under 256KB');
                              return;
                            }
                            const reader = new FileReader();
                            reader.onload = async () => {
                              const dataUrl = reader.result as string;
                              try {
                                const res = await fetch(`${API_BASE}/api/superadmin/logo`, {
                                  method: 'PUT',
                                  headers: { 'Content-Type': 'application/json', 'X-Superadmin-Token': superadminToken! },
                                  body: JSON.stringify({ logo: dataUrl })
                                });
                                const data = await res.json() as { success: boolean };
                                if (data.success) {
                                  setCustomLogo(dataUrl);
                                }
                              } catch (err) {
                                console.error('Logo upload failed:', err);
                              }
                            };
                            reader.readAsDataURL(file);
                            e.target.value = '';
                          }}
                        />
                      </label>
                      {customLogo && (
                        <button
                          className="refresh-btn"
                          style={{ padding: '0.4rem 0.75rem', fontSize: '0.85rem' }}
                          onClick={async () => {
                            try {
                              const res = await fetch(`${API_BASE}/api/superadmin/logo`, {
                                method: 'DELETE',
                                headers: { 'X-Superadmin-Token': superadminToken! }
                              });
                              const data = await res.json() as { success: boolean };
                              if (data.success) {
                                setCustomLogo(null);
                              }
                            } catch (err) {
                              console.error('Logo reset failed:', err);
                            }
                          }}
                        >
                          Reset
                        </button>
                      )}
                    </div>
                    <span className="field-descriptor" style={{ marginLeft: 'auto' }}>PNG, JPG, SVG or WebP, max 256KB</span>
                  </div>

                  {boundServices && Object.keys(boundServices).length > 0 && (
                    <>
                      <div className="config-item" style={{ marginTop: '1rem', borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: '0.75rem' }}>
                        <strong style={{ opacity: 0.5, fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Bound Services</strong>
                      </div>
                      {Object.entries(boundServices).map(([key, value]) => (
                        <div className="config-item" key={key}>
                          <strong>{key}:</strong>
                          <span style={{ fontFamily: 'monospace', fontSize: '0.8rem', opacity: 0.7 }}>{value}</span>
                        </div>
                      ))}
                    </>
                  )}
                </div>
                  </div>
                )}
              </section>
            )}

            {/* Users Section - Same as admin panel but accessible from superadmin */}
            {superadminSection === 'users' && (
              <section className="admin-card">
                <div className="admin-card-header">
                  <h2>
                    User Management
                    {nodeName && <span className="node-badge">Node: {nodeName}</span>}
                    {dbUsers.length > 0 && <span className="count-badge">{dbUsers.length}</span>}
                  </h2>
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <button
                      onClick={() => { fetchCantonUsers(); setShowPartiesModal(true); }}
                      className="send-btn admin-btn"
                    >
                      Canton Parties
                    </button>
                    <button
                      onClick={() => fetchDbUsers()}
                      className="refresh-btn"
                      disabled={adminLoading}
                    >
                      {adminLoading ? 'Loading...' : 'Refresh'}
                    </button>
                  </div>
                </div>

                <div className="admin-users-table user-mgmt-table">
                <div className="admin-table-header">
                  <span>Username</span>
                  <span>Display Name</span>
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
                      <span className="admin-cell party-id-cell" title={user.party_id || ''}>
                        {user.party_id || 'Not linked'}
                      </span>
                      <span className="admin-cell">
                        <div className="action-buttons">
                          <button
                            onClick={() => handleAdminTapFaucet(user.username)}
                            className="btn-edit"
                            title="Add 100 CC to this user"
                          >
                            Faucet
                          </button>
                          <button
                            onClick={async () => {
                              if (appsList.length === 0) await fetchApps();
                              if (Object.keys(appAccessMap).length === 0) await fetchAppAccess();
                              setUserAppAccessModalUser(user);
                            }}
                            className="btn-edit"
                            title="Manage app access"
                          >
                            Apps
                          </button>
                          <button
                            onClick={() => handleDeleteUser(user.id)}
                            className="btn-delete"
                          >
                            Delete
                          </button>
                        </div>
                      </span>
                    </div>
                  ))
                )}
                </div>
              </section>
            )}

            {/* User App Access Modal */}
            {userAppAccessModalUser && (
              <div className="modal-overlay" onClick={() => setUserAppAccessModalUser(null)}>
                <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '500px' }}>
                  <h2>App Access: {userAppAccessModalUser.display_name || userAppAccessModalUser.username}</h2>
                  <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '1rem' }}>
                    Toggle which apps this user can access. Apps with no users assigned are visible to everyone.
                  </p>
                  <div style={{ maxHeight: '400px', overflowY: 'auto' }}>
                    {appsList.length === 0 ? (
                      <div className="no-transactions">No apps configured.</div>
                    ) : (
                      appsList.map((app) => {
                        const hasAccess = appAccessMap[app.id]?.includes(userAppAccessModalUser.id) || false;
                        const isRestricted = (appAccessMap[app.id]?.length || 0) > 0;
                        return (
                          <div key={app.id} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.5rem 0', borderBottom: '1px solid var(--border-color)' }}>
                            <label className="toggle-switch">
                              <input
                                type="checkbox"
                                checked={hasAccess}
                                onChange={() => {
                                  if (hasAccess) {
                                    handleRevokeAppAccess(userAppAccessModalUser.id, app.id);
                                  } else {
                                    handleGrantAppAccess(userAppAccessModalUser.id, app.id);
                                  }
                                }}
                              />
                              <span className="toggle-slider"></span>
                            </label>
                            <span
                              className="app-icon-preview"
                              style={{ backgroundColor: app.color, width: '28px', height: '28px', fontSize: '14px' }}
                            >
                              {app.icon}
                            </span>
                            <div>
                              <strong>{app.name}</strong>
                              {!isRestricted && !hasAccess && (
                                <span style={{ color: 'var(--text-secondary)', marginLeft: '0.5rem', fontSize: '0.8rem' }}>(open)</span>
                              )}
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                  <div className="modal-buttons" style={{ marginTop: '1rem' }}>
                    <button onClick={() => setUserAppAccessModalUser(null)} className="refresh-btn">
                      Close
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Canton Parties Modal */}
            {showPartiesModal && (
              <div className="modal-overlay" onClick={() => setShowPartiesModal(false)}>
                <div className="settings-window" style={{ maxWidth: '600px' }} onClick={(e) => e.stopPropagation()}>
                  <div className="app-window-header">
                    <div className="app-window-title">Canton Parties {cantonUsers.length > 0 && <span className="count-badge">{cantonUsers.length}</span>}</div>
                    <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                      <button onClick={() => setShowCreateUser(true)} className="send-btn admin-btn" style={{ fontSize: '0.8rem', padding: '0.3rem 0.75rem' }}>+ New Party</button>
                      <button className="app-window-close" onClick={() => setShowPartiesModal(false)}>✕</button>
                    </div>
                  </div>
                  <div className="app-window-content">
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
                  </div>
                </div>
              </div>
            )}

            {/* Registration Codes Section */}
            {superadminSection === 'codes' && (
              <section className="admin-card">
                <div className="admin-card-header">
                  <h2>
                    Registration Codes
                    {registrationCodes.length > 0 && <span className="count-badge">{registrationCodes.length}</span>}
                  </h2>
                  <button
                    onClick={() => setShowCreateCode(true)}
                    className="send-btn admin-btn"
                  >
                    + New Code
                  </button>
                </div>

                <div className="admin-codes-list">
                  {regCodesLoading ? (
                    <div className="no-transactions">Loading codes...</div>
                  ) : registrationCodes.length === 0 ? (
                    <div className="no-transactions">No registration codes found</div>
                  ) : (
                    <div className="admin-users-table">
                      <div className="admin-table-header">
                        <span>Code</span>
                        <span>Type</span>
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
                          {code.codeType === 'reserved_username' ? (
                            <span>
                              <span style={{ background: 'rgba(99, 102, 241, 0.15)', color: 'var(--accent-primary)', padding: '2px 6px', borderRadius: '4px', fontSize: '0.8rem' }}>Reserved</span>
                              {code.reservedUsername && (
                                <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '2px' }}>{code.reservedUsername}</div>
                              )}
                            </span>
                          ) : (
                            <span style={{ background: 'rgba(40, 167, 69, 0.15)', color: '#28a745', padding: '2px 6px', borderRadius: '4px', fontSize: '0.8rem' }}>General</span>
                          )}
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
                        <span className="admin-cell">
                          <div className="action-buttons">
                            <button
                              onClick={() => copyCodeUrl(code.code)}
                              className="btn-edit"
                              title="Copy registration URL"
                            >
                              Copy URL
                            </button>
                            <button
                              onClick={() => handleDeleteCode(code.id)}
                              className="btn-delete"
                            >
                              Delete
                            </button>
                          </div>
                        </span>
                      </div>
                    ))}
                    </div>
                  )}
                </div>
              </section>
            )}

            {/* Daml Packages Modal */}
            {showPackagesModal && (
              <div className="modal-overlay" onClick={() => setShowPackagesModal(false)}>
                <div className="settings-window" style={{ maxWidth: '600px' }} onClick={(e) => e.stopPropagation()}>
                  <div className="app-window-header">
                    <div className="app-window-title">Daml Packages {packageIds.length > 0 && <span className="count-badge">{packageIds.length}</span>}</div>
                    <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                      <button
                        onClick={() => setShowInstallFromUrl(true)}
                        className="send-btn admin-btn"
                        disabled={darUploading}
                        style={{ fontSize: '0.8rem', padding: '0.3rem 0.75rem' }}
                      >
                        Install from URL
                      </button>
                      <label
                        className="send-btn admin-btn"
                        style={{ cursor: darUploading ? 'not-allowed' : 'pointer', fontSize: '0.8rem', padding: '0.3rem 0.75rem' }}
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
                      <button className="app-window-close" onClick={() => setShowPackagesModal(false)}>✕</button>
                    </div>
                  </div>
                  <div className="app-window-content">
                    {/* Install from URL form */}
                    {showInstallFromUrl && (
                      <div className="modal-backdrop" onClick={() => setShowInstallFromUrl(false)}>
                        <div className="modal-content" onClick={(e) => e.stopPropagation()}>
                          <h3>Install DAR from URL</h3>
                          <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', marginBottom: '1rem' }}>
                            Enter the base URL of the app. The DAR will be fetched from <code>/api/package</code>.
                          </p>
                          <div className="form-group">
                            <label>App URL</label>
                            <input
                              type="url"
                              value={darInstallUrl}
                              onChange={(e) => setDarInstallUrl(e.target.value)}
                              placeholder="https://example.com"
                              disabled={darUploading}
                            />
                          </div>
                          <div className="modal-actions">
                            <button
                              onClick={() => {
                                setShowInstallFromUrl(false);
                                setDarInstallUrl('');
                              }}
                              className="cancel-btn"
                              disabled={darUploading}
                            >
                              Cancel
                            </button>
                            <button
                              onClick={handleDarInstallFromUrl}
                              className="send-btn admin-btn"
                              disabled={darUploading || !darInstallUrl.trim()}
                            >
                              {darUploading ? 'Installing...' : 'Install'}
                            </button>
                          </div>
                        </div>
                      </div>
                    )}

                    {darUploadStatus && (
                      <div className={`transfer-status ${darUploadStatus.includes('Error') ? 'error' : 'success'}`} style={{ marginBottom: '1rem' }}>
                        {darUploadStatus}
                      </div>
                    )}

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
                  </div>
                </div>
              </div>
            )}

            {/* RPC Endpoints Section */}
            {superadminSection === 'rpc' && (
              <section className="admin-card">
                <div className="admin-card-header">
                  <h2>RPC Endpoints</h2>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                    {/* Network Toggle */}
                    <div className="rpc-network-toggle" style={{ marginRight: '0.5rem' }}>
                      <button
                        className={`toggle-btn ${rpcNetworkMode === 'mainnet' ? 'active' : ''}`}
                        onClick={() => setRpcNetworkMode('mainnet')}
                      >
                        <span className="toggle-indicator mainnet"></span>
                        Mainnet
                      </button>
                      <button
                        className={`toggle-btn ${rpcNetworkMode === 'testnet' ? 'active' : ''}`}
                        onClick={() => setRpcNetworkMode('testnet')}
                      >
                        <span className="toggle-indicator testnet"></span>
                        Testnet
                      </button>
                    </div>
                    {superadminUser.isSuperadmin && (
                      <button
                        onClick={() => {
                          // Initialize with first available chain
                          if (availableChains.length > 0) {
                            const first = availableChains[0];
                            setNewRpc({
                              chain_type: first.chain_type,
                              chain_name: first.chain,
                              chain_id: first.chain_id || '',
                              network: 'mainnet',
                              name: '',
                              rpc_url: '',
                              priority: 0,
                              is_enabled: true
                            });
                          }
                          setShowAddRpc(true);
                        }}
                        className="send-btn admin-btn"
                      >
                        + Add RPC
                      </button>
                    )}
                  </div>
                </div>

                <div className="section-content">
                  {rpcLoading ? (
                    <div className="loading-msg">Loading RPC endpoints...</div>
                  ) : rpcEndpoints.length === 0 ? (
                    <div className="empty-msg">No RPC endpoints configured. Click "Add RPC" to add one.</div>
                  ) : (() => {
                    const filteredEndpoints = rpcEndpoints.filter(ep => ep.network === rpcNetworkMode);
                    return (
                    <div className="rpc-table-container">
                      <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>
                        Showing {filteredEndpoints.length} {rpcNetworkMode} endpoint{filteredEndpoints.length !== 1 ? 's' : ''}
                      </p>
                      <table className="admin-table">
                        <thead>
                          <tr>
                            <th>Chain</th>
                            <th>Chain ID</th>
                            <th>Provider</th>
                            <th>RPC URL</th>
                            <th>Priority</th>
                            <th>Status</th>
                            {superadminUser.isSuperadmin && <th>Actions</th>}
                          </tr>
                        </thead>
                        <tbody>
                          {filteredEndpoints.map(ep => (
                              <tr key={ep.id} className={ep.is_enabled === 0 ? 'disabled-row' : ''}>
                                <td>
                                  <span className="chain-badge" title={ep.chain_type.toUpperCase()}>{ep.chain_name || ep.chain_type.toUpperCase()}</span>
                                </td>
                                <td>{ep.chain_id || '-'}</td>
                                <td>{ep.name || '-'}</td>
                                <td>
                                  <code className="rpc-url-cell" title={ep.rpc_url}>
                                    {ep.rpc_url.length > 45 ? ep.rpc_url.slice(0, 45) + '...' : ep.rpc_url}
                                  </code>
                                </td>
                                <td>{ep.priority}</td>
                                <td>
                                  <button
                                    onClick={() => handleToggleRpcEnabled(ep)}
                                    className={`status-badge ${ep.is_enabled ? 'enabled' : 'disabled'}`}
                                    disabled={!superadminUser.isSuperadmin}
                                  >
                                    {ep.is_enabled ? 'Enabled' : 'Disabled'}
                                  </button>
                                </td>
                                {superadminUser.isSuperadmin && (
                                  <td>
                                    <div className="action-buttons">
                                      <button
                                        onClick={() => setEditingRpc(ep)}
                                        className="btn-edit"
                                        title="Edit"
                                      >
                                        Edit
                                      </button>
                                      <button
                                        onClick={() => handleDeleteRpc(ep.id)}
                                        className="btn-delete"
                                        title="Delete"
                                      >
                                        Delete
                                      </button>
                                    </div>
                                  </td>
                                )}
                              </tr>
                            ))}
                        </tbody>
                      </table>
                    </div>
                    );
                  })()}
                </div>
              </section>
            )}

            {/* Add RPC Modal */}
            {showAddRpc && (
              <div className="modal-overlay" onClick={() => setShowAddRpc(false)}>
                <div className="modal-content" onClick={(e) => e.stopPropagation()}>
                  <h2>Add RPC Endpoint</h2>
                  <form onSubmit={handleAddRpc}>
                    <div className="form-group">
                      <label>Chain</label>
                      <select
                        value={`${newRpc.chain_type}:${newRpc.chain_name}`}
                        onChange={(e) => {
                          const parts = e.target.value.split(':');
                          const chainType = parts[0];
                          const chainName = parts.slice(1).join(':'); // Handle chain names with colons
                          const selectedChain = availableChains.find(c => c.chain_type === chainType && c.chain === chainName);
                          setNewRpc({
                            ...newRpc,
                            chain_type: chainType,
                            chain_name: chainName,
                            chain_id: selectedChain?.chain_id || ''
                          });
                        }}
                        required
                        disabled={availableChains.length === 0}
                      >
                        {availableChains.length === 0 ? (
                          <option value="">Loading chains...</option>
                        ) : (
                          availableChains.map(c => (
                            <option key={`${c.chain_type}:${c.chain}`} value={`${c.chain_type}:${c.chain}`}>
                              {c.chain} ({c.chain_type.toUpperCase()}{c.chain_id ? ` - ${c.chain_id}` : ''})
                            </option>
                          ))
                        )}
                      </select>
                    </div>
                    <div className="form-group">
                      <label>Network</label>
                      <select
                        value={newRpc.network}
                        onChange={(e) => setNewRpc({...newRpc, network: e.target.value})}
                        required
                      >
                        <option value="mainnet">Mainnet</option>
                        <option value="testnet">Testnet</option>
                      </select>
                    </div>
                    <div className="form-group">
                      <label>Name (optional)</label>
                      <input
                        type="text"
                        value={newRpc.name}
                        onChange={(e) => setNewRpc({...newRpc, name: e.target.value})}
                        placeholder="e.g., ZAN.top Ethereum Mainnet"
                      />
                    </div>
                    <div className="form-group">
                      <label>RPC URL</label>
                      <input
                        type="url"
                        value={newRpc.rpc_url}
                        onChange={(e) => setNewRpc({...newRpc, rpc_url: e.target.value})}
                        placeholder="https://..."
                        required
                      />
                    </div>
                    <div className="form-group">
                      <label>Priority</label>
                      <input
                        type="number"
                        min="0"
                        value={newRpc.priority}
                        onChange={(e) => setNewRpc({...newRpc, priority: parseInt(e.target.value) || 0})}
                      />
                      <small>Lower = higher priority (0 = primary)</small>
                    </div>
                    <div className="modal-buttons">
                      <button type="button" onClick={() => setShowAddRpc(false)} className="refresh-btn">
                        Cancel
                      </button>
                      <button type="submit" className="send-btn admin-btn">
                        Add Endpoint
                      </button>
                    </div>
                  </form>
                </div>
              </div>
            )}

            {/* Edit RPC Modal */}
            {editingRpc && (
              <div className="modal-overlay" onClick={() => setEditingRpc(null)}>
                <div className="modal-content" onClick={(e) => e.stopPropagation()}>
                  <h2>Edit RPC Endpoint</h2>
                  <form onSubmit={handleUpdateRpc}>
                    <div className="form-group">
                      <label>Chain</label>
                      <select
                        value={`${editingRpc.chain_type}:${editingRpc.chain_name}`}
                        onChange={(e) => {
                          const parts = e.target.value.split(':');
                          const chainType = parts[0];
                          const chainName = parts.slice(1).join(':');
                          const selectedChain = availableChains.find(c => c.chain_type === chainType && c.chain === chainName);
                          setEditingRpc({
                            ...editingRpc,
                            chain_type: chainType,
                            chain_name: chainName,
                            chain_id: selectedChain?.chain_id || null
                          });
                        }}
                        required
                      >
                        {availableChains.map(c => (
                          <option key={`${c.chain_type}:${c.chain}`} value={`${c.chain_type}:${c.chain}`}>
                            {c.chain} ({c.chain_type.toUpperCase()}{c.chain_id ? ` - ${c.chain_id}` : ''})
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="form-group">
                      <label>Network</label>
                      <select
                        value={editingRpc.network}
                        onChange={(e) => setEditingRpc({...editingRpc, network: e.target.value})}
                        required
                      >
                        <option value="mainnet">Mainnet</option>
                        <option value="testnet">Testnet</option>
                      </select>
                    </div>
                    <div className="form-group">
                      <label>Name (optional)</label>
                      <input
                        type="text"
                        value={editingRpc.name || ''}
                        onChange={(e) => setEditingRpc({...editingRpc, name: e.target.value || null})}
                        placeholder="e.g., ZAN.top Ethereum Mainnet"
                      />
                    </div>
                    <div className="form-group">
                      <label>RPC URL</label>
                      <input
                        type="url"
                        value={editingRpc.rpc_url}
                        onChange={(e) => setEditingRpc({...editingRpc, rpc_url: e.target.value})}
                        placeholder="https://..."
                        required
                      />
                    </div>
                    <div className="form-group">
                      <label>Priority</label>
                      <input
                        type="number"
                        min="0"
                        value={editingRpc.priority}
                        onChange={(e) => setEditingRpc({...editingRpc, priority: parseInt(e.target.value) || 0})}
                      />
                    </div>
                    <div className="modal-buttons">
                      <button type="button" onClick={() => setEditingRpc(null)} className="refresh-btn">
                        Cancel
                      </button>
                      <button type="submit" className="send-btn admin-btn">
                        Update Endpoint
                      </button>
                    </div>
                  </form>
                </div>
              </div>
            )}

            {/* Dock Apps Section */}
            {superadminSection === 'apps' && (
              <section className="admin-card">
                <div className="admin-card-header">
                  <h2>Dock Apps</h2>
                  {superadminUser.isSuperadmin && (
                    <button
                      onClick={() => setShowAddApp(true)}
                      className="send-btn admin-btn"
                    >
                      + Add App
                    </button>
                  )}
                </div>

                <div className="section-content">
                  <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '1rem' }}>
                    Apps added here will appear in the dock. URLs are automatically allowed as iframe origins.
                  </p>
                  {appsLoading ? (
                    <div className="loading-msg">Loading apps...</div>
                  ) : appsList.length === 0 ? (
                    <div className="empty-msg">No apps configured. Click "Add App" to add one.</div>
                  ) : (
                    <div className="rpc-table-container">
                      <table className="admin-table">
                        <thead>
                          <tr>
                            <th>Icon</th>
                            <th>Name</th>
                            <th>URL</th>
                            <th>Order</th>
                            <th>Status</th>
                            {superadminUser.isSuperadmin && <th>Access</th>}
                            {superadminUser.isSuperadmin && <th>Actions</th>}
                          </tr>
                        </thead>
                        <tbody>
                          {appsList.map(app => {
                            const pkgStatus = appPackageStatus[app.id];
                            const accessCount = appAccessMap[app.id]?.length || 0;
                            return (
                            <tr key={app.id} className={app.is_enabled === 0 ? 'disabled-row' : ''}>
                              <td>
                                <span
                                  className="app-icon-preview"
                                  style={{ backgroundColor: app.color }}
                                >
                                  {app.icon}
                                </span>
                              </td>
                              <td>{app.name}</td>
                              <td>
                                {app.url ? (
                                  <code className="rpc-url-cell" title={app.url}>
                                    {app.url.length > 40 ? app.url.slice(0, 40) + '...' : app.url}
                                  </code>
                                ) : (
                                  <span style={{ color: 'var(--text-secondary)' }}>Built-in</span>
                                )}
                              </td>
                              <td>{app.sort_order}</td>
                              <td>
                                <button
                                  onClick={() => handleToggleAppEnabled(app)}
                                  className={`status-badge ${app.is_enabled ? 'enabled' : 'disabled'}`}
                                  disabled={!superadminUser.isSuperadmin}
                                >
                                  {app.is_enabled ? 'Enabled' : 'Disabled'}
                                </button>
                              </td>
                              {superadminUser.isSuperadmin && (
                                <td>
                                  <button
                                    onClick={() => setAppAccessModalApp(app)}
                                    className={`status-badge ${accessCount > 0 ? 'enabled' : ''}`}
                                    style={{ cursor: 'pointer', minWidth: '60px' }}
                                    title={accessCount > 0 ? `${accessCount} user(s) assigned` : 'All users (open access)'}
                                  >
                                    {accessCount > 0 ? `${accessCount} user${accessCount !== 1 ? 's' : ''}` : 'All'}
                                  </button>
                                </td>
                              )}
                              {superadminUser.isSuperadmin && (
                                <td>
                                  <div className="action-buttons">
                                    {app.url && (
                                      pkgStatus?.status === 'na' ? (
                                        <span className="status-na" title={pkgStatus.message}>N/A</span>
                                      ) : (
                                        <button
                                          onClick={() => checkAndInstallAppPackage(app.id, app.url!)}
                                          className={`btn-install ${pkgStatus?.status === 'ready' ? 'success' : ''} ${pkgStatus?.status === 'not_installed' ? 'warning' : ''}`}
                                          title={pkgStatus?.status === 'ready' ? 'Package installed' : 'Install DAR Package'}
                                          disabled={pkgStatus?.status === 'checking' || pkgStatus?.status === 'installing' || pkgStatus?.status === 'ready'}
                                        >
                                          {pkgStatus?.status === 'checking' ? 'Checking...' :
                                           pkgStatus?.status === 'installing' ? 'Installing...' :
                                           pkgStatus?.status === 'ready' ? 'Installed' :
                                           pkgStatus?.status === 'not_installed' ? 'Install DAR' :
                                           pkgStatus?.status === 'error' ? 'Retry' :
                                           'Check'}
                                        </button>
                                      )
                                    )}
                                    <button
                                      onClick={() => setEditingApp(app)}
                                      className="btn-edit"
                                      title="Edit"
                                    >
                                      Edit
                                    </button>
                                    <button
                                      onClick={() => handleDeleteApp(app.id)}
                                      className="btn-delete"
                                      title="Delete"
                                    >
                                      Delete
                                    </button>
                                  </div>
                                  {pkgStatus?.status === 'error' && (
                                    <div className="error-hint" title={pkgStatus.message}>
                                      {pkgStatus.message}
                                    </div>
                                  )}
                                </td>
                              )}
                            </tr>
                          );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </section>
            )}

            {/* Add App Modal */}
            {showAddApp && (
              <div className="modal-overlay" onClick={() => setShowAddApp(false)}>
                <div className="modal-content" onClick={(e) => e.stopPropagation()}>
                  <h2>Add Dock App</h2>
                  <form onSubmit={handleAddApp}>
                    <div className="form-group">
                      <label>ID (optional, auto-generated if empty)</label>
                      <input
                        type="text"
                        value={newApp.id}
                        onChange={(e) => setNewApp({...newApp, id: e.target.value})}
                        placeholder="e.g., my-app"
                        pattern="[a-z0-9_-]*"
                        title="Only lowercase letters, numbers, hyphens, and underscores"
                      />
                    </div>
                    <div className="form-group">
                      <label>Name</label>
                      <input
                        type="text"
                        value={newApp.name}
                        onChange={(e) => setNewApp({...newApp, name: e.target.value})}
                        placeholder="e.g., My App"
                        required
                      />
                    </div>
                    <div className="form-group">
                      <label>Icon (emoji or character)</label>
                      <div className="emoji-input-wrapper">
                        <input
                          type="text"
                          value={newApp.icon}
                          onChange={(e) => setNewApp({...newApp, icon: e.target.value})}
                          placeholder="e.g., 🚀"
                          required
                          maxLength={4}
                        />
                        <button
                          type="button"
                          className="emoji-picker-toggle"
                          onClick={() => setEmojiPickerTarget(emojiPickerTarget === 'new' ? null : 'new')}
                        >
                          {newApp.icon || '😀'}
                        </button>
                        {renderEmojiPicker('new')}
                      </div>
                    </div>
                    <div className="form-group">
                      <label>Color (hex)</label>
                      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                        <input
                          type="color"
                          value={newApp.color}
                          onChange={(e) => setNewApp({...newApp, color: e.target.value})}
                          style={{ width: '50px', height: '36px', padding: 0, border: 'none' }}
                        />
                        <input
                          type="text"
                          value={newApp.color}
                          onChange={(e) => setNewApp({...newApp, color: e.target.value})}
                          placeholder="#6366f1"
                          pattern="#[0-9A-Fa-f]{6}"
                          style={{ flex: 1 }}
                        />
                      </div>
                    </div>
                    <div className="form-group">
                      <label>URL (optional - leave empty for built-in apps)</label>
                      <input
                        type="url"
                        value={newApp.url}
                        onChange={(e) => setNewApp({...newApp, url: e.target.value})}
                        placeholder="https://..."
                      />
                    </div>
                    <div className="form-group">
                      <label>Sort Order</label>
                      <input
                        type="number"
                        min="0"
                        value={newApp.sort_order}
                        onChange={(e) => setNewApp({...newApp, sort_order: parseInt(e.target.value) || 0})}
                      />
                      <small>Lower numbers appear first</small>
                    </div>
                    <div className="modal-buttons">
                      <button type="button" onClick={() => setShowAddApp(false)} className="refresh-btn">
                        Cancel
                      </button>
                      <button type="submit" className="send-btn admin-btn">
                        Add App
                      </button>
                    </div>
                  </form>
                </div>
              </div>
            )}

            {/* Edit App Modal */}
            {editingApp && (
              <div className="modal-overlay" onClick={() => setEditingApp(null)}>
                <div className="modal-content" onClick={(e) => e.stopPropagation()}>
                  <h2>Edit Dock App</h2>
                  <form onSubmit={handleUpdateApp}>
                    <div className="form-group">
                      <label>ID</label>
                      <input
                        type="text"
                        value={editingApp.id}
                        disabled
                        style={{ opacity: 0.6 }}
                      />
                    </div>
                    <div className="form-group">
                      <label>Name</label>
                      <input
                        type="text"
                        value={editingApp.name}
                        onChange={(e) => setEditingApp({...editingApp, name: e.target.value})}
                        placeholder="e.g., My App"
                        required
                      />
                    </div>
                    <div className="form-group">
                      <label>Icon (emoji or character)</label>
                      <div className="emoji-input-wrapper">
                        <input
                          type="text"
                          value={editingApp.icon}
                          onChange={(e) => setEditingApp({...editingApp, icon: e.target.value})}
                          placeholder="e.g., 🚀"
                          required
                          maxLength={4}
                        />
                        <button
                          type="button"
                          className="emoji-picker-toggle"
                          onClick={() => setEmojiPickerTarget(emojiPickerTarget === 'edit' ? null : 'edit')}
                        >
                          {editingApp.icon || '😀'}
                        </button>
                        {renderEmojiPicker('edit')}
                      </div>
                    </div>
                    <div className="form-group">
                      <label>Color (hex)</label>
                      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                        <input
                          type="color"
                          value={editingApp.color}
                          onChange={(e) => setEditingApp({...editingApp, color: e.target.value})}
                          style={{ width: '50px', height: '36px', padding: 0, border: 'none' }}
                        />
                        <input
                          type="text"
                          value={editingApp.color}
                          onChange={(e) => setEditingApp({...editingApp, color: e.target.value})}
                          placeholder="#6366f1"
                          pattern="#[0-9A-Fa-f]{6}"
                          style={{ flex: 1 }}
                        />
                      </div>
                    </div>
                    <div className="form-group">
                      <label>URL (optional)</label>
                      <input
                        type="url"
                        value={editingApp.url || ''}
                        onChange={(e) => setEditingApp({...editingApp, url: e.target.value || null})}
                        placeholder="https://..."
                      />
                    </div>
                    <div className="form-group">
                      <label>Sort Order</label>
                      <input
                        type="number"
                        min="0"
                        value={editingApp.sort_order}
                        onChange={(e) => setEditingApp({...editingApp, sort_order: parseInt(e.target.value) || 0})}
                      />
                    </div>
                    <div className="modal-buttons">
                      <button type="button" onClick={() => setEditingApp(null)} className="refresh-btn">
                        Cancel
                      </button>
                      <button type="submit" className="send-btn admin-btn">
                        Update App
                      </button>
                    </div>
                  </form>
                </div>
              </div>
            )}

            {/* App Access Modal */}
            {appAccessModalApp && (() => {
              const assignedUsers = appAccessUsers[appAccessModalApp.id] || [];
              const assignedIds = new Set(appAccessMap[appAccessModalApp.id] || []);
              const searchLower = appAccessSearch.toLowerCase().trim();
              const suggestions = searchLower.length > 0
                ? dbUsers.filter(u =>
                    !assignedIds.has(u.id) &&
                    (u.username.toLowerCase().includes(searchLower) ||
                     (u.display_name || '').toLowerCase().includes(searchLower))
                  ).slice(0, 8)
                : [];
              return (
              <div className="modal-overlay" onClick={() => { setAppAccessModalApp(null); setAppAccessSearch(''); }}>
                <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '500px' }}>
                  <h2>App Access: {appAccessModalApp.name}</h2>
                  <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '1rem' }}>
                    {assignedUsers.length === 0
                      ? 'No users assigned — this app is visible to everyone.'
                      : `${assignedUsers.length} user${assignedUsers.length !== 1 ? 's' : ''} assigned. Only these users can see this app.`}
                  </p>

                  {/* Search and add user */}
                  <div style={{ position: 'relative', marginBottom: '1rem' }}>
                    <input
                      type="text"
                      value={appAccessSearch}
                      onChange={(e) => setAppAccessSearch(e.target.value)}
                      placeholder="Search users to add..."
                      style={{ width: '100%' }}
                      autoFocus
                    />
                    {suggestions.length > 0 && (
                      <div style={{
                        position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 10,
                        background: 'var(--card-bg)', border: '1px solid var(--border-color)',
                        borderRadius: '8px', marginTop: '4px', boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
                        maxHeight: '200px', overflowY: 'auto'
                      }}>
                        {suggestions.map(user => (
                          <button
                            key={user.id}
                            onClick={() => {
                              handleGrantAppAccess(user.id, appAccessModalApp.id);
                              setAppAccessSearch('');
                            }}
                            style={{
                              display: 'block', width: '100%', padding: '0.5rem 0.75rem',
                              background: 'transparent', border: 'none', textAlign: 'left',
                              cursor: 'pointer', color: 'var(--text-primary)', fontSize: '0.85rem'
                            }}
                            onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--accent-bg-hover)')}
                            onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                          >
                            <strong>{user.display_name || user.username}</strong>
                            <span style={{ color: 'var(--text-secondary)', marginLeft: '0.5rem' }}>@{user.username}</span>
                          </button>
                        ))}
                      </div>
                    )}
                    {searchLower.length > 0 && suggestions.length === 0 && (
                      <div style={{
                        position: 'absolute', top: '100%', left: 0, right: 0,
                        background: 'var(--card-bg)', border: '1px solid var(--border-color)',
                        borderRadius: '8px', marginTop: '4px', padding: '0.5rem 0.75rem',
                        color: 'var(--text-secondary)', fontSize: '0.85rem'
                      }}>
                        No matching users found
                      </div>
                    )}
                  </div>

                  {/* Assigned users list */}
                  <div style={{ maxHeight: '300px', overflowY: 'auto' }}>
                    {assignedUsers.length === 0 ? (
                      <div style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', padding: '0.5rem 0' }}>
                        No users assigned. Search above to add users.
                      </div>
                    ) : (
                      assignedUsers.map((user) => (
                        <div key={user.user_id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.4rem 0', borderBottom: '1px solid var(--border-color)' }}>
                          <div>
                            <strong>{user.display_name || user.username}</strong>
                            <span style={{ color: 'var(--text-secondary)', marginLeft: '0.5rem', fontSize: '0.85rem' }}>@{user.username}</span>
                          </div>
                          <button
                            onClick={() => handleRevokeAppAccess(user.user_id, appAccessModalApp.id)}
                            className="btn-delete"
                            style={{ padding: '0.2rem 0.5rem', fontSize: '0.75rem' }}
                          >
                            Remove
                          </button>
                        </div>
                      ))
                    )}
                  </div>

                  <div className="modal-buttons" style={{ marginTop: '1rem' }}>
                    <button onClick={() => { setAppAccessModalApp(null); setAppAccessSearch(''); }} className="refresh-btn">
                      Close
                    </button>
                  </div>
                </div>
              </div>
              );
            })()}
          </main>
        </div>

        {/* Create Admin User Modal */}
        {showCreateAdminUser && (
          <div className="modal-overlay" onClick={() => setShowCreateAdminUser(false)}>
            <div className="modal-content" onClick={(e) => e.stopPropagation()}>
              <h2>Create Admin User</h2>
              <form onSubmit={handleCreateAdminUser}>
                <div className="form-group">
                  <label>Username (required)</label>
                  <input
                    type="text"
                    value={newAdminUsername}
                    onChange={(e) => setNewAdminUsername(e.target.value)}
                    placeholder="e.g., admin1"
                    required
                    pattern="[a-z0-9_-]+"
                    title="Only lowercase letters, numbers, hyphens, and underscores"
                  />
                </div>
                <div className="form-group">
                  <label>Password (required)</label>
                  <input
                    type="password"
                    value={newAdminPassword}
                    onChange={(e) => setNewAdminPassword(e.target.value)}
                    placeholder="Enter password"
                    required
                    minLength={6}
                  />
                </div>
                <div className="form-group">
                  <label>Display Name (optional)</label>
                  <input
                    type="text"
                    value={newAdminDisplayName}
                    onChange={(e) => setNewAdminDisplayName(e.target.value)}
                    placeholder="e.g., Admin User"
                  />
                </div>
                <div className="form-group" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <input
                    type="checkbox"
                    id="isSuperadmin"
                    checked={newAdminIsSuperadmin}
                    onChange={(e) => setNewAdminIsSuperadmin(e.target.checked)}
                    style={{ width: 'auto' }}
                  />
                  <label htmlFor="isSuperadmin" style={{ cursor: 'pointer' }}>Grant Superadmin Privileges</label>
                </div>
                <div className="modal-buttons">
                  <button
                    type="button"
                    onClick={() => {
                      setShowCreateAdminUser(false);
                      setNewAdminUsername('');
                      setNewAdminPassword('');
                      setNewAdminDisplayName('');
                      setNewAdminIsSuperadmin(false);
                    }}
                    className="refresh-btn"
                  >
                    Cancel
                  </button>
                  <button type="submit" className="send-btn admin-btn">
                    Create Admin
                  </button>
                </div>
              </form>
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
                  <button type="submit" className="send-btn admin-btn">
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

        {/* Create Code Modal */}
        {showCreateCode && (
          <div className="modal-overlay" onClick={() => setShowCreateCode(false)}>
            <div className="modal-content" onClick={(e) => e.stopPropagation()}>
              <h2>Create Registration Code</h2>
              <form onSubmit={handleCreateCode}>
                <div className="form-group">
                  <label>Code Type</label>
                  <select
                    value={newCodeType}
                    onChange={(e) => setNewCodeType(e.target.value as 'general' | 'reserved_username')}
                    className="role-select"
                  >
                    <option value="general">General</option>
                    <option value="reserved_username">Reserved Username</option>
                  </select>
                </div>
                {newCodeType === 'reserved_username' && (
                  <div className="form-group">
                    <label>Reserved Username</label>
                    <input
                      type="text"
                      value={newCodeReservedUsername}
                      onChange={(e) => setNewCodeReservedUsername(e.target.value)}
                      placeholder="e.g., alice"
                      required
                    />
                    <small style={{ color: 'var(--text-secondary)' }}>Only this username can register with this code (single use)</small>
                  </div>
                )}
                {newCodeType !== 'reserved_username' && (
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
                )}
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
                      setNewCodeType('general');
                      setNewCodeReservedUsername('');
                      setCreateCodeStatus('');
                    }}
                    className="refresh-btn"
                  >
                    Cancel
                  </button>
                  <button type="submit" className="send-btn admin-btn">
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
            <div className="login-logo">
              <img src={customLogo || '/logo.png'} alt={orgName} />
            </div>
            <h1>{orgName}</h1>
            <p className="login-subtitle">Secure Digital Asset Management</p>

            {loginError && (
              <div className="login-error">{loginError}</div>
            )}

            {/* Sign in section */}
            <button
              onClick={() => { setAuthMode('login'); handlePasskeyLogin(); }}
              className="login-btn-primary"
              disabled={authLoading}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/>
                <polyline points="10 17 15 12 10 7"/>
                <line x1="15" y1="12" x2="3" y2="12"/>
              </svg>
              {authLoading && authMode === 'login' ? 'Authenticating...' : 'Sign In'}
            </button>

            {/* Create Account - collapsed by default */}
            {authMode !== 'register' ? (
              <button
                onClick={() => setAuthMode('register')}
                className="login-btn-ghost"
              >
                Create Account
              </button>
            ) : (
              <div className="login-register-panel">
                <div className="login-field">
                  <label>{codeValidation.codeType === 'reserved_username' ? 'Username (set by invite)' : 'Username'}</label>
                  <input
                    type="text"
                    value={loginUsername}
                    onChange={(e) => setLoginUsername(e.target.value)}
                    placeholder={codeValidation.codeType === 'reserved_username' ? 'Set by invite code' : 'Choose a username'}
                    disabled={!codeValidation.valid || codeValidation.codeType === 'reserved_username'}
                    readOnly={codeValidation.codeType === 'reserved_username'}
                    className={codeValidation.codeType === 'reserved_username' ? 'readonly' : ''}
                  />
                </div>

                {/* Registration code status */}
                {codeValidation.checked && (
                  <div className={`login-code-status ${codeValidation.valid ? 'valid' : 'invalid'}`}>
                    {codeValidation.valid ? (
                      codeValidation.codeType === 'reserved_username' ? (
                        <>Invite valid &mdash; registering as <strong>{codeValidation.reservedUsername}</strong></>
                      ) : (
                        <>Code valid &mdash; {codeValidation.usesRemaining} use{codeValidation.usesRemaining !== 1 ? 's' : ''} remaining</>
                      )
                    ) : codeValidation.reason === 'no_code' ? (
                      <>Registration code required</>
                    ) : codeValidation.reason === 'invalid_code' ? (
                      <>Invalid registration code</>
                    ) : codeValidation.reason === 'expired' ? (
                      <>Code expired</>
                    ) : codeValidation.reason === 'depleted' ? (
                      <>Code fully used</>
                    ) : (
                      <>Unable to validate code</>
                    )}
                  </div>
                )}

                <button
                  onClick={() => handlePasskeyRegister()}
                  className="login-btn-primary"
                  disabled={authLoading || !codeValidation.valid}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/>
                    <circle cx="9" cy="7" r="4"/>
                    <line x1="19" y1="8" x2="19" y2="14"/>
                    <line x1="22" y1="11" x2="16" y2="11"/>
                  </svg>
                  {authLoading && authMode === 'register' ? 'Authenticating...' : 'Register'}
                </button>

                <button
                  onClick={() => setAuthMode('login')}
                  className="login-btn-ghost"
                >
                  Back to Sign In
                </button>
              </div>
            )}
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
          logo={customLogo}
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
          onRefresh={() => loadWalletData(true)}
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
                  loadWalletData(true);
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

              // For multi-chain assets, look up chainType from the selected chain
              let assetChainType = asset.chainType || 'evm';
              if (chain && asset.chains && asset.chains.length > 0) {
                const selectedChainInfo = asset.chains.find(c => c.chain === chain);
                if (selectedChainInfo) {
                  assetChainType = selectedChainInfo.chainType;
                }
              }
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
                  loadWalletData(true);
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
                  loadWalletData(true);
                  return { success: true, message: `Success! TX: ${result.txid}` };
                }
                case 'svm': {
                  const solAddr = chainAddresses.find(a => a.chain === 'Solana')?.address;
                  if (!solAddr) {
                    return { success: false, message: 'No Solana wallet found' };
                  }

                  // Check if this is a native SOL transfer or SPL token transfer
                  const isNativeSol = asset.symbol === 'SOL';

                  if (isNativeSol) {
                    // Native SOL transfer
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
                    loadWalletData(true);
                    return { success: true, message: `Success! TX: ${result.signature}` };
                  } else {
                    // SPL Token transfer (USDC, USDT, etc.)
                    // Get token mint address from asset chains
                    const chainInfo = asset.chains?.find(c => c.chain === 'Solana' || c.chainType === 'svm');
                    const mintAddress = chainInfo?.contractAddress;
                    if (!mintAddress) {
                      return { success: false, message: `No Solana contract address found for ${asset.symbol}` };
                    }

                    // Get token decimals (default to 6 for USDC/USDT)
                    const decimals = chainInfo?.decimals || 6;

                    // Check token balance
                    const tokenBalance = await solSigner.getTokenBalance(mintAddress, solAddr, 'mainnet');
                    const tokenAmount = BigInt(Math.floor(amountNum * Math.pow(10, decimals)));

                    if (tokenBalance < tokenAmount) {
                      return { success: false, message: `Insufficient ${asset.symbol} balance. Have: ${(Number(tokenBalance) / Math.pow(10, decimals)).toFixed(decimals)} ${asset.symbol}` };
                    }

                    // Also need some SOL for transaction fees
                    const solBalance = await solSigner.getBalance(solAddr, 'mainnet');
                    const minSolForFee = 10000; // ~0.00001 SOL for fee
                    if (solBalance < minSolForFee) {
                      return { success: false, message: `Insufficient SOL for transaction fee. Need at least 0.00001 SOL` };
                    }

                    const result = await solSigner.signAndSendTokenTransfer(to, tokenAmount, mintAddress, privateKey, decimals, 'mainnet');
                    loadWalletData(true);
                    return { success: true, message: `Success! TX: ${result.signature}` };
                  }
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
                  loadWalletData(true);
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
                  loadWalletData(true);
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
          onSettings={() => { setShowSettingsModal(true); loadPasskeys(); }}
          transactionPagination={transactionPagination}
          onLoadMoreTransactions={async (offset: number, chainFilter?: string) => {
            if (!authUser || !sessionId) return;
            const headers = { 'Authorization': `Bearer ${sessionId}` };
            const params = new URLSearchParams();
            params.set('limit', '20');
            params.set('offset', offset.toString());
            if (chainFilter) params.set('chain', chainFilter);
            try {
              const res = await fetch(`${API_BASE}/api/wallet/transactions?${params.toString()}`, { headers });
              const data = await res.json() as TransactionsApiResponse;
              if (data.success && data.data) {
                if (offset === 0) {
                  setTransactions(data.data);
                } else {
                  setTransactions(prev => [...prev, ...data.data!]);
                }
                if (data.pagination) {
                  setTransactionPagination(data.pagination);
                }
              }
            } catch (error) {
              console.error('Failed to load more transactions:', error);
            }
          }}
        />

      {/* Settings Modal */}
      {showSettingsModal && (
        <div className="modal-overlay" onClick={() => setShowSettingsModal(false)}>
          <div className="settings-window" onClick={(e) => e.stopPropagation()}>
            <div className="app-window-header">
              <div className="app-window-title">Settings</div>
              <button className="app-window-close" onClick={() => setShowSettingsModal(false)}>✕</button>
            </div>
            <div className="app-window-content">
              {/* Network Mode */}
              <div className="settings-section">
                <div className="settings-section-header">
                  <span className="settings-section-label">Network</span>
                </div>
                <div className="config-item" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.5rem 0' }}>
                  <span style={{ fontSize: '0.85rem' }}>{networkMode === 'mainnet' ? 'Mainnet' : 'Testnet'}</span>
                  <label className="network-switch" title={networkMode === 'mainnet' ? 'Switch to Testnet' : 'Switch to Mainnet'}>
                    <input
                      type="checkbox"
                      checked={networkMode === 'testnet'}
                      onChange={(e) => {
                        const mode = e.target.checked ? 'testnet' : 'mainnet';
                        setNetworkMode(mode);
                        localStorage.setItem('walletNetworkMode', mode);
                        loadWalletData(true, mode);
                      }}
                    />
                    <span className="switch-slider"></span>
                  </label>
                </div>
              </div>

              {authUser?.id && (
                <div className="settings-section">
                  <div className="settings-section-header">
                    <span className="settings-section-label">User ID</span>
                  </div>
                  <div className="config-item" style={{ fontSize: '0.8rem', fontFamily: 'monospace', wordBreak: 'break-all', opacity: 0.7, padding: '0.5rem 0' }}>
                    {authUser.id}
                  </div>
                </div>
              )}

              <div className="settings-section-header">
                <span className="settings-section-label">Passkeys</span>
                <span className="passkey-count">{passkeys.length}/5</span>
              </div>

              {settingsError && (
                <div className="settings-error">{settingsError}</div>
              )}

              {settingsLoading ? (
                <div className="settings-loading">Loading...</div>
              ) : (
                <div className="passkey-list">
                  {passkeys.map((pk) => (
                    <div key={pk.id} className="passkey-item">
                      <div className="passkey-info">
                        <span className="passkey-name">{pk.name}</span>
                        <span className="passkey-meta">
                          {pk.deviceType === 'singleDevice' ? 'Single device' : 'Multi-device'}
                          {pk.backedUp && <span className="passkey-synced">Synced</span>}
                          <span className="passkey-sep">·</span>
                          {new Date(pk.createdAt).toLocaleDateString()}
                        </span>
                      </div>
                      <button
                        className="app-window-close passkey-delete"
                        onClick={() => handleDeletePasskey(pk.id)}
                        disabled={deletingPasskeyId === pk.id || passkeys.length <= 1}
                        title={passkeys.length <= 1 ? 'Cannot delete last passkey' : 'Delete passkey'}
                      >
                        {deletingPasskeyId === pk.id ? '·' : '✕'}
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {passkeys.length < 5 && (
                <form className="add-passkey-form" onSubmit={(e) => { e.preventDefault(); handleAddPasskey(newPasskeyName); }}>
                  <input
                    type="text"
                    className="add-passkey-input"
                    placeholder="Passkey name (e.g. MacBook, iPhone)"
                    value={newPasskeyName}
                    onChange={(e) => setNewPasskeyName(e.target.value)}
                    disabled={addingPasskey}
                  />
                  <button
                    type="submit"
                    className="btn-add-passkey"
                    disabled={addingPasskey}
                  >
                    {addingPasskey ? 'Adding...' : 'Add'}
                  </button>
                </form>
              )}
            </div>
          </div>
        </div>
      )}

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

      {/* Empty workspace hint */}
      {openAppSessions.size === 0 && activeApp === null && (
        <div className="workspace-empty-hint">
          Hover over dock to start apps
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
        const floatState = floatingApps[appId];
        const isFloating = !!floatState?.floating;
        // Floating windows are always visible; fullscreen windows only when active
        const shouldShow = isFloating || isVisible;

        return (
          <div
            key={appId}
            data-floating-app={isFloating ? appId : undefined}
            className={`app-window ${shouldShow ? 'visible' : 'hidden'} ${isFloating ? 'floating' : ''}`}
            style={shouldShow ? (isFloating
              ? { display: 'flex', left: floatState.x, top: floatState.y, width: floatState.width, height: floatState.height, zIndex: focusedApp === appId ? 910 : 901 }
              : { display: 'flex', zIndex: 950 }
            ) : { display: 'none' }}
            onMouseDown={() => { if (isFloating) setFocusedApp(appId); }}
          >
            <div
              className="app-window-header"
              onMouseDown={(e) => { if (isFloating) startAppDrag(appId, e); }}
              onTouchStart={(e) => { if (isFloating) startAppDrag(appId, e); }}
            >
              <div
                className="app-window-title"
                onWheel={app.url ? (e) => {
                  e.preventDefault();
                  const delta = e.deltaY > 0 ? -5 : 5;
                  setAppZoom(prev => {
                    const current = prev[appId] || 100;
                    const next = Math.min(200, Math.max(25, current + delta));
                    return { ...prev, [appId]: next };
                  });
                  setZoomTooltipApp(appId);
                  if (zoomTooltipTimerRef.current) clearTimeout(zoomTooltipTimerRef.current);
                  zoomTooltipTimerRef.current = setTimeout(() => setZoomTooltipApp(null), 800);
                } : undefined}
              >
                <span className="app-window-icon">{app.icon}</span> {app.name}
                {zoomTooltipApp === appId && (
                  <span className="app-zoom-tooltip">{appZoom[appId] || 100}%</span>
                )}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '2px' }}>
                {appUrl && (
                  <button
                    className="app-window-float-toggle"
                    onClick={() => {
                      const iframe = iframeRefs.current.get(appId);
                      if (iframe && iframe.src) {
                        const src = iframe.src;
                        iframe.src = '';
                        setTimeout(() => { iframe.src = src; }, 50);
                      }
                    }}
                    title="Refresh"
                  >
<svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M1.5 6a4.5 4.5 0 014.5-4.5A4.5 4.5 0 0110 3.5l.5.5"/><path d="M10.5 1.5v2.5H8"/><path d="M10.5 6a4.5 4.5 0 01-4.5 4.5A4.5 4.5 0 012 8.5l-.5-.5"/><path d="M1.5 10.5V8H4"/></svg>
                  </button>
                )}
                <button
                  className="app-window-float-toggle"
                  onClick={() => toggleAppFloating(appId)}
                  title={isFloating ? 'Maximize' : 'Float window'}
                >
{isFloating ? (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="1.5" y="1.5" width="9" height="9" rx="1"/></svg>
) : (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="2.5" y="3.5" width="7" height="7" rx="1"/><path d="M4.5 3.5V2.5a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-1"/></svg>
)}
                </button>
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
                    // Clean up floating state
                    setFloatingApps(prev => {
                      const { [appId]: _, ...rest } = prev;
                      return rest;
                    });
                  }}
                >✕</button>
              </div>
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
                  style={appZoom[appId] && appZoom[appId] !== 100 ? {
                    transform: `scale(${appZoom[appId] / 100})`,
                    transformOrigin: 'top left',
                    width: `${10000 / appZoom[appId]}%`,
                    height: `${10000 / appZoom[appId]}%`,
                  } : undefined}
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
            {isFloating && (
              <div
                className="app-resize-handle"
                onMouseDown={(e) => startAppResize(appId, e)}
                onTouchStart={(e) => startAppResize(appId, e)}
              />

            )}
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
          {chatLoading && (
            <div className="chat-message assistant">
              <div className="chat-message-content chat-typing">Thinking...</div>
            </div>
          )}
        </div>
        <form className="chat-input-form" onSubmit={handleSendChat}>
          <input
            type="text"
            value={chatInput}
            onChange={(e) => setChatInput(e.target.value)}
            placeholder="Ask me anything..."
            className="chat-input"
            disabled={chatLoading}
          />
          <button type="submit" className="chat-send-btn" aria-label="Send" disabled={chatLoading}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M22 2L11 13" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M22 2L15 22L11 13L2 9L22 2Z" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
        </form>
      </div>

      {/* Snap Layout Picker */}
      {snapLayoutVisible && (() => {
        const floatingCount = Object.values(floatingApps).filter(s => s.floating).length;
        const layouts = floatingCount === 1 ? [
          { icon: '⬜', label: 'Center' },
          { icon: '⬛', label: 'Maximize' },
        ] : floatingCount === 2 ? [
          { icon: '◧', label: 'Side by Side' },
          { icon: '⬒', label: 'Stacked' },
        ] : floatingCount === 3 ? [
          { icon: '⬕', label: '1 + 2 Right' },
          { icon: '⬔', label: '2 Left + 1' },
          { icon: '☰', label: '3 Columns' },
        ] : [
          { icon: '⊞', label: 'Grid' },
          { icon: '☰', label: 'Columns' },
        ];
        return (
          <div className="snap-layout-picker" style={{ left: snapLayoutPosition.x, top: snapLayoutPosition.y }}>
            <div className="snap-layout-options">
              {layouts.map((layout, i) => (
                <div
                  key={i}
                  className={`snap-layout-option ${snapLayoutHovered === i ? 'hovered' : ''}`}
                >
                  <span className="snap-layout-icon">{layout.icon}</span>
                  <span className="snap-layout-label">{layout.label}</span>
                </div>
              ))}
            </div>
            <div className="snap-layout-hint">Move up/down to select, release to apply</div>
          </div>
        );
      })()}
    </div>
  );
}

export default App;
