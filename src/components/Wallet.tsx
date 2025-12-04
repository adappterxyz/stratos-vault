import { useState, useEffect } from 'react';
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
  isCustom?: boolean;
}

interface ChainAddress {
  chain: string;
  address: string;
  icon: string;
}

interface Transaction {
  transactionId: string;
  type: 'send' | 'receive';
  amount: number;
  from: string;
  to: string;
  timestamp: string;
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
  assets: Asset[];
  transactions: Transaction[];
  transferOffers: TransferOffer[];
  chainAddresses: ChainAddress[];
  scannedAddress?: string;
  onLogout: () => void;
  onNavigateAdmin: () => void;
  onRefresh: () => void;
  onAddAsset: () => void;
  onDeleteAsset: (id: string) => void;
  onAcceptOffer: (contractId: string) => void;
  onTransfer: (to: string, amount: string, asset?: Asset, chain?: string) => Promise<{ success: boolean; message: string }>;
  onStartQrScanner: () => void;
  onScannedAddressUsed?: () => void;
}

export default function Wallet({
  authUser,
  orgName,
  assets,
  transactions,
  transferOffers,
  chainAddresses,
  scannedAddress,
  onLogout,
  onNavigateAdmin,
  onRefresh,
  onAddAsset,
  onDeleteAsset,
  onAcceptOffer,
  onTransfer,
  onStartQrScanner,
  onScannedAddressUsed,
}: WalletProps) {
  const [walletCollapsed, setWalletCollapsed] = useState(false);
  const [assetsExpanded, setAssetsExpanded] = useState(true);
  const [transactionsExpanded, setTransactionsExpanded] = useState(true);
  const [selectedAsset, setSelectedAsset] = useState<Asset | null>(null);
  const [selectedChain, setSelectedChain] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [showQrCode, setShowQrCode] = useState(false);
  const [transferTo, setTransferTo] = useState('');
  const [transferAmount, setTransferAmount] = useState('');
  const [transferStatus, setTransferStatus] = useState('');

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
        {walletCollapsed ? '☰' : '✕'}
      </button>

      <div className="wallet-card-wrapper">
        <div className={`wallet-card ${walletCollapsed ? 'collapsed' : ''}`}>
          <div className="wallet-content">
            {/* Header row */}
            <div className="wallet-header">
              <div className="wallet-title">
                <span className="wallet-name">{orgName}</span>
                <span className="wallet-user">@{authUser.username}</span>
              </div>
              <div className="wallet-actions">
                {authUser.role === 'admin' && (
                  <button onClick={onNavigateAdmin} className="btn-icon" title="Admin">
                    ⚙
                  </button>
                )}
                <button onClick={onLogout} className="btn-icon btn-logout" title="Logout">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
                    <polyline points="16 17 21 12 16 7"/>
                    <line x1="21" y1="12" x2="9" y2="12"/>
                  </svg>
                </button>
              </div>
            </div>

            {/* Assets Section */}
            <div className="wallet-section">
              <div className="section-header-row clickable" onClick={() => setAssetsExpanded(!assetsExpanded)}>
                <div className="section-label">
                  <span className={`section-arrow ${assetsExpanded ? 'expanded' : ''}`}>▶</span>
                  Assets ({assets.length})
                </div>
                <div className="section-actions" onClick={(e) => e.stopPropagation()}>
                  <button onClick={onAddAsset} className="btn-add" title="Add Custom Asset">+</button>
                  <button onClick={onRefresh} className="btn-refresh" title="Refresh">↻</button>
                </div>
              </div>
              {assetsExpanded && (
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
                        <span className="asset-balance">{asset.balance.toFixed(2)} {asset.symbol}</span>
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
              )}
            </div>

            {/* Pending Offers */}
            {transferOffers.length > 0 && (
              <div className="wallet-section">
                <div className="section-label">Pending ({transferOffers.length})</div>
                <div className="offers-list">
                  {transferOffers.map((offer) => (
                    <div key={offer.contract_id} className="offer-row">
                      <span className="offer-amt">{parseFloat(offer.payload.amount.amount).toFixed(2)} CC</span>
                      <span className="offer-sender">{offer.payload.sender.split('::')[0]}</span>
                      <button onClick={() => onAcceptOffer(offer.contract_id)} className="btn-accept">Accept</button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Transactions */}
            <div className="wallet-section">
              <div className="section-header-row clickable" onClick={() => setTransactionsExpanded(!transactionsExpanded)}>
                <div className="section-label">
                  <span className={`section-arrow ${transactionsExpanded ? 'expanded' : ''}`}>▶</span>
                  Transactions ({transactions.length})
                </div>
              </div>
              {transactionsExpanded && (
                transactions.length === 0 ? (
                  <div className="empty-msg">No transactions</div>
                ) : (
                  <div className="tx-list">
                    {transactions.map((tx) => (
                      <div key={tx.transactionId} className="tx-row">
                        <span className={`tx-icon ${tx.type}`}>{tx.type === 'send' ? '↑' : '↓'}</span>
                        <span className="tx-amt">{tx.type === 'send' ? '−' : '+'}{Math.abs(tx.amount).toFixed(2)}</span>
                        <span className="tx-peer">{tx.type === 'send' ? tx.to.split('::')[0] : tx.from.split('::')[0]}</span>
                        <span className="tx-date">{new Date(tx.timestamp).toLocaleDateString()}</span>
                      </div>
                    ))}
                  </div>
                )
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
                  <span className="asset-balance-display">{selectedAsset.balance.toFixed(2)} {selectedAsset.symbol}</span>
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
                        <button type="submit" className="btn-send">Send</button>
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
    </>
  );
}
