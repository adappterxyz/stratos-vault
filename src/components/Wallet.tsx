import { useState, useEffect } from 'react';
import { Wallet as WalletIcon } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { TokenIcon } from '../TokenIcon';

interface Asset {
  id?: string;
  symbol: string;
  name: string;
  balance: number;
  icon: string | null;
  chain?: string;
  chainType?: string;
  chains?: { chain: string; chainType: string; contractAddress: string | null; decimals: number }[];
  chainBalances?: Record<string, number>;  // Per-chain balance breakdown
  isCustom?: boolean;
}

interface ChainAddress {
  chain: string;
  address: string;
  icon: string;
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

interface TransferOffer {
  contract_id: string;
  payload: {
    sender: string;
    amount: { amount: string };
  };
}

interface AuthUser {
  id: string;
  username: string;
  displayName: string | null;
  role: string;
}

interface WalletProps {
  authUser: AuthUser;
  orgName: string;
  logo?: string | null;
  assets: Asset[];
  transactions: Transaction[];
  transactionPagination: TransactionPagination | null;
  transferOffers: TransferOffer[];
  chainAddresses: ChainAddress[];
  scannedAddress?: string;
  onLogout: () => void;
  onRefresh: () => void;
  onAddAsset: () => void;
  onDeleteAsset: (id: string) => void;
  onAcceptOffer: (contractId: string) => void;
  onTransfer: (to: string, amount: string, asset?: Asset, chain?: string) => Promise<{ success: boolean; message: string }>;
  onStartQrScanner: () => void;
  onScannedAddressUsed?: () => void;
  onLoadMoreTransactions: (offset: number, chainFilter?: string) => void;
  onSettings: () => void;
}

export default function Wallet({
  authUser,
  orgName,
  logo,
  assets,
  transactions,
  transactionPagination,
  transferOffers,
  chainAddresses,
  scannedAddress,
  onLogout,
  onRefresh,
  onAddAsset,
  onDeleteAsset,
  onAcceptOffer,
  onTransfer,
  onStartQrScanner,
  onScannedAddressUsed,
  onLoadMoreTransactions,
  onSettings,
}: WalletProps) {
  const [walletCollapsed, setWalletCollapsed] = useState(false);
  const [activeTab, setActiveTab] = useState<'assets' | 'transactions'>('assets');
  const [selectedAsset, setSelectedAsset] = useState<Asset | null>(null);
  const [selectedChain, setSelectedChain] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [showQrCode, setShowQrCode] = useState(false);
  const [transferTo, setTransferTo] = useState('');
  const [transferAmount, setTransferAmount] = useState('');
  const [transferStatus, setTransferStatus] = useState('');
  const [showAllTransactions, setShowAllTransactions] = useState(false);
  const [txChainFilter, setTxChainFilter] = useState<string>('all');

  // Handle scanned address from parent
  useEffect(() => {
    if (scannedAddress) {
      setTransferTo(scannedAddress);
      onScannedAddressUsed?.();
    }
  }, [scannedAddress, onScannedAddressUsed]);

  const handleTransfer = async (e: React.FormEvent) => {
    e.preventDefault();
    setTransferStatus('Sending...');

    // Pass selected asset and chain for multi-chain support
    const result = await onTransfer(transferTo, transferAmount, selectedAsset || undefined, selectedChain || undefined);
    setTransferStatus(result.message);

    if (result.success) {
      setTransferTo('');
      setTransferAmount('');
    }

    setTimeout(() => setTransferStatus(''), 5000);
  };

  return (
    <>
      <button
        className="wallet-toggle"
        onClick={() => setWalletCollapsed(!walletCollapsed)}
        title={walletCollapsed ? 'Show wallet' : 'Hide wallet'}
      >
        {walletCollapsed ? <WalletIcon size={18} /> : '✕'}
      </button>

      <div className="wallet-card-wrapper">
        <div className={`wallet-card ${walletCollapsed ? 'collapsed' : ''}`}>
          <div className="wallet-content">
            {/* Header row */}
            <div className="wallet-header">
              <div className="wallet-title">
                <img src={logo || '/logo.png'} alt="" className="wallet-logo" />
                <div className="wallet-title-text">
                  <span className="wallet-name">{orgName}</span>
                  <span className="wallet-user">@{authUser.username}</span>
                </div>
              </div>
              <div className="wallet-actions">
                <button onClick={onSettings} className="btn-icon btn-settings" title="Settings">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/>
                    <circle cx="12" cy="12" r="3"/>
                  </svg>
                </button>
                <button onClick={onLogout} className="btn-icon btn-logout" title="Logout">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
                    <polyline points="16 17 21 12 16 7"/>
                    <line x1="21" y1="12" x2="9" y2="12"/>
                  </svg>
                </button>
              </div>
            </div>

            {/* Tab Bar */}
            <div className="wallet-tabs">
              <button
                className={`wallet-tab ${activeTab === 'assets' ? 'active' : ''}`}
                onClick={() => setActiveTab('assets')}
              >
                Assets ({assets.length})
              </button>
              <button
                className={`wallet-tab ${activeTab === 'transactions' ? 'active' : ''}`}
                onClick={() => setActiveTab('transactions')}
              >
                Transactions {transactionPagination ? `(${transactionPagination.total})` : `(${transactions.length})`}
              </button>
              <div className="wallet-tab-actions">
                {activeTab === 'assets' && (
                  <>
                    <button onClick={onAddAsset} className="btn-add" title="Add Custom Asset">+</button>
                    <button onClick={onRefresh} className="btn-refresh" title="Refresh">↻</button>
                  </>
                )}
                {activeTab === 'transactions' && transactionPagination && transactionPagination.total > 10 && (
                  <button
                    className="btn-view-all"
                    onClick={() => setShowAllTransactions(true)}
                  >
                    View All
                  </button>
                )}
              </div>
            </div>

            <div className="wallet-tab-content">
            {/* Assets Tab */}
            {activeTab === 'assets' && (
              <div className="wallet-section">
                {/* Pending Offers */}
                {transferOffers.length > 0 && (
                  <div className="offers-section">
                    <div className="section-label">Pending ({transferOffers.length})</div>
                    <div className="offers-list">
                      {transferOffers.map((offer) => (
                        <div key={offer.contract_id} className="offer-row">
                          <span className="offer-amt">{parseFloat(offer.payload.amount.amount).toFixed(4)} CC</span>
                          <span className="offer-sender">{offer.payload.sender.split('::')[0]}</span>
                          <button onClick={() => onAcceptOffer(offer.contract_id)} className="btn-accept">Accept</button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="assets-list">
                  {assets.map((asset) => (
                    <div
                      key={`${asset.symbol}-${asset.chainType || asset.chain}`}
                      className={`asset-row clickable ${selectedAsset?.symbol === asset.symbol ? 'selected' : ''}`}
                      onClick={() => setSelectedAsset(selectedAsset?.symbol === asset.symbol ? null : asset)}
                    >
                      <div className="asset-info">
                        <span className="asset-icon">
                          <TokenIcon symbol={asset.symbol} fallbackIcon={asset.icon || undefined} size={24} />
                        </span>
                        <div className="asset-details">
                          <span className="asset-name">{asset.name}</span>
                          <div className="asset-chains">
                            {asset.chains && asset.chains.length > 0 ? (
                              asset.chains.map(c => (
                                <span key={c.chainType} className="chain-badge">{c.chain}</span>
                              ))
                            ) : (
                              asset.chain && <span className="chain-badge">{asset.chain}</span>
                            )}
                            {asset.isCustom && <span className="chain-badge custom-badge">Custom</span>}
                          </div>
                        </div>
                      </div>
                      <div className="asset-row-right">
                        <div className="balance-with-tooltip">
                          <span className="asset-balance">{asset.balance.toFixed(4)} {asset.symbol}</span>
                          {asset.chainBalances && Object.keys(asset.chainBalances).length > 1 && (
                            <div className="balance-tooltip">
                              {Object.entries(asset.chainBalances).map(([chain, bal]) => (
                                <div key={chain} className="balance-tooltip-row">
                                  <span className="tooltip-chain">{chain}</span>
                                  <span className="tooltip-balance">{bal.toFixed(4)}</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                        {asset.isCustom && asset.id && (
                          <button
                            className="btn-delete-asset"
                            onClick={(e) => { e.stopPropagation(); onDeleteAsset(asset.id!); }}
                            title="Remove custom asset"
                          >
                            ✕
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Transactions Tab */}
            {activeTab === 'transactions' && (
              <div className="wallet-section">
                {transactions.length === 0 ? (
                  <div className="empty-msg">No transactions</div>
                ) : (
                  <div className="tx-list">
                    {transactions.slice(0, 10).map((tx) => (
                      <div key={tx.id} className={`tx-row ${tx.status === 'pending' ? 'pending' : ''}`}>
                        <span className="tx-icon-wrapper">
                          <TokenIcon symbol={tx.asset} size={20} />
                        </span>
                        <span className="tx-amt">
                          {tx.type === 'send' ? '−' : '+'}{parseFloat(tx.amount).toFixed(4)} {tx.asset}
                        </span>
                        <span className="tx-chain">{tx.chain}</span>
                        <span className={`tx-direction ${tx.type}`}>
                          {tx.type === 'send' ? '↑' : tx.type === 'receive' ? '↓' : tx.type === 'tap' ? '💧' : '↔'}
                        </span>
                        <span className="tx-date">{new Date(tx.blockTimestamp || tx.createdAt).toLocaleString()}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
            </div>
          </div>
        </div>
      </div>

      {/* Asset Transfer Modal */}
      {selectedAsset && (
        <div className="asset-modal-overlay" onClick={() => { setSelectedAsset(null); setSelectedChain(null); }}>
          <div className="asset-modal" onClick={(e) => e.stopPropagation()}>
            <div className="asset-modal-header">
              <div className="asset-modal-title">
                <span className="asset-icon">
                  <TokenIcon symbol={selectedAsset.symbol} fallbackIcon={selectedAsset.icon || undefined} size={32} />
                </span>
                <div>
                  <h3>{selectedAsset.name}</h3>
                  <span className="asset-balance-display">{selectedAsset.balance.toFixed(4)} {selectedAsset.symbol}</span>
                </div>
              </div>
              <button onClick={() => { setSelectedAsset(null); setSelectedChain(null); }} className="asset-modal-close">✕</button>
            </div>

            {/* Chain Selector (for multi-chain assets) */}
            {(() => {
              const assetChains = selectedAsset.chains?.map(c => c.chain) || [selectedAsset.chain];
              const relevantAddresses = chainAddresses.filter(a => assetChains.includes(a.chain));
              const hasMultipleChains = relevantAddresses.length > 1;

              // Auto-select first chain if not set
              const currentChain = selectedChain || relevantAddresses[0]?.chain || selectedAsset.chain;
              const currentAddress = relevantAddresses.find(a => a.chain === currentChain);

              return (
                <>
                  {hasMultipleChains && (
                    <div className="asset-modal-section chain-selector-section">
                      <div className="asset-modal-label">Network</div>
                      <select
                        className="chain-dropdown"
                        value={currentChain || ''}
                        onChange={(e) => setSelectedChain(e.target.value)}
                      >
                        {relevantAddresses.map(addr => (
                          <option key={addr.chain} value={addr.chain}>{addr.chain}</option>
                        ))}
                      </select>
                    </div>
                  )}

                  {/* Receive Address */}
                  <div className="asset-modal-section">
                    <div className="asset-modal-label">
                      Receive {selectedAsset.symbol} {hasMultipleChains && `on ${currentChain}`}
                    </div>
                    {currentAddress && (
                      <div className="chain-address-item">
                        <div className="asset-modal-address">
                          <span className="asset-modal-address-text">{currentAddress.address}</span>
                          <div className="asset-modal-address-actions">
                            <button
                              onClick={() => {
                                navigator.clipboard.writeText(currentAddress.address);
                                setCopied(true);
                                setTimeout(() => setCopied(false), 2000);
                              }}
                              className={`btn-icon-xs ${copied ? 'copied' : ''}`}
                              title="Copy"
                            >
                              {copied ? '✓' : '⎘'}
                            </button>
                            <button
                              onClick={() => setShowQrCode(!showQrCode)}
                              className={`btn-icon-xs ${showQrCode ? 'active' : ''}`}
                              title="QR"
                            >
                              ⊞
                            </button>
                          </div>
                        </div>
                        {showQrCode && (
                          <div className="qr-display-sm">
                            <QRCodeSVG value={currentAddress.address} size={120} bgColor="#ffffff" fgColor="#1e1e3f" />
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Send Form */}
                  <div className="asset-modal-section">
                    <div className="asset-modal-label">
                      Send {selectedAsset.symbol} {hasMultipleChains && `on ${currentChain}`}
                    </div>
                    <form onSubmit={handleTransfer} className="send-form">
                      <div className="input-with-action">
                        <input
                          type="text"
                          value={transferTo}
                          onChange={(e) => setTransferTo(e.target.value)}
                          placeholder={`Recipient ${currentChain} Address`}
                          required
                          className="input-sm"
                        />
                        <button type="button" onClick={onStartQrScanner} className="btn-scan" title="Scan QR">
                          ⌘
                        </button>
                      </div>
                      <div className="send-row">
                        <input
                          type="number"
                          step="0.01"
                          value={transferAmount}
                          onChange={(e) => setTransferAmount(e.target.value)}
                          placeholder="Amount"
                          required
                          className="input-sm input-amount-sm"
                        />
                        <div className="send-action-group">
                          {currentChain && selectedAsset.chainBalances?.[currentChain] !== undefined && (
                            <span className="chain-balance-hint">
                              {selectedAsset.chainBalances[currentChain].toFixed(4)} {selectedAsset.symbol}
                            </span>
                          )}
                          <button type="submit" className="btn-send">Send</button>
                        </div>
                      </div>
                    </form>
                    {transferStatus && (
                      <div className={`status-msg ${transferStatus.includes('Error') ? 'error' : 'success'}`}>
                        {transferStatus}
                      </div>
                    )}
                  </div>
                </>
              );
            })()}
          </div>
        </div>
      )}

      {/* All Transactions Modal */}
      {showAllTransactions && (
        <div className="modal-overlay" onClick={() => setShowAllTransactions(false)}>
          <div className="modal-content transactions-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>All Transactions</h2>
              <button onClick={() => setShowAllTransactions(false)} className="modal-close">✕</button>
            </div>

            {/* Chain Filter */}
            <div className="tx-filters">
              <select
                value={txChainFilter}
                onChange={(e) => {
                  setTxChainFilter(e.target.value);
                  onLoadMoreTransactions(0, e.target.value === 'all' ? undefined : e.target.value);
                }}
                className="tx-chain-filter"
              >
                <option value="all">All Chains</option>
                <option value="Canton">Canton</option>
                <option value="Ethereum">Ethereum</option>
                <option value="Base">Base</option>
                <option value="Bitcoin">Bitcoin</option>
                <option value="Solana">Solana</option>
                <option value="Tron">Tron</option>
                <option value="TON">TON</option>
              </select>
              {transactionPagination && (
                <span className="tx-count">{transactionPagination.total} transactions</span>
              )}
            </div>

            {/* Transactions List */}
            <div className="tx-list-full">
              {transactions.length === 0 ? (
                <div className="empty-msg">No transactions found</div>
              ) : (
                transactions.map((tx) => (
                  <div key={tx.id} className={`tx-row-full ${tx.status === 'pending' ? 'pending' : ''}`}>
                    <div className="tx-row-left">
                      <span className="tx-icon-wrapper">
                        <TokenIcon symbol={tx.asset} size={24} />
                        <span className={`tx-direction ${tx.type}`}>
                          {tx.type === 'send' ? '↑' : tx.type === 'receive' ? '↓' : tx.type === 'tap' ? '💧' : '↔'}
                        </span>
                      </span>
                      <div className="tx-details">
                        <span className="tx-type">{tx.type.charAt(0).toUpperCase() + tx.type.slice(1)}</span>
                        <span className="tx-peer-full">
                          {tx.type === 'send' ? `To: ${tx.to?.split('::')[0] || 'Unknown'}` :
                           tx.type === 'receive' ? `From: ${tx.from?.split('::')[0] || 'Unknown'}` :
                           tx.description || ''}
                        </span>
                      </div>
                    </div>
                    <div className="tx-row-right">
                      <span className={`tx-amt-full ${tx.type === 'send' ? 'negative' : 'positive'}`}>
                        {tx.type === 'send' ? '−' : '+'}{parseFloat(tx.amount).toFixed(4)} {tx.asset}
                      </span>
                      <span className="tx-chain-badge">{tx.chain}</span>
                      <span className="tx-date-full">{new Date(tx.blockTimestamp && tx.blockTimestamp.length > 0 ? tx.blockTimestamp : tx.createdAt).toLocaleString()}</span>
                      {tx.status === 'pending' && <span className="tx-status-badge pending">Pending</span>}
                      {tx.status === 'failed' && <span className="tx-status-badge failed">Failed</span>}
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Pagination */}
            {transactionPagination && transactionPagination.hasMore && (
              <div className="tx-pagination">
                <button
                  onClick={() => onLoadMoreTransactions(
                    transactionPagination.offset + transactionPagination.limit,
                    txChainFilter === 'all' ? undefined : txChainFilter
                  )}
                  className="btn-load-more"
                >
                  Load More
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
