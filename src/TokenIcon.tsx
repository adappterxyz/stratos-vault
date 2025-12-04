import { useState, useEffect } from 'react';

interface TokenIconProps {
  symbol: string;
  fallbackIcon?: string;
  size?: number;
  className?: string;
}

// Web3icons raw GitHub URL for branded token icons
const WEB3ICONS_CDN = 'https://raw.githubusercontent.com/0xa3k5/web3icons/main/packages/core/src/svgs/tokens/branded';

export function TokenIcon({ symbol, fallbackIcon = '●', size = 24, className = '' }: TokenIconProps) {
  const [iconSrc, setIconSrc] = useState<'web3' | 'local' | 'fallback'>('web3');
  const upperSymbol = symbol.toUpperCase();
  const lowerSymbol = symbol.toLowerCase();

  // Reset icon source when symbol changes
  useEffect(() => {
    setIconSrc('web3');
  }, [symbol]);

  // Special case for Canton Coin - use local icon
  if (lowerSymbol === 'cc' || lowerSymbol === 'canton') {
    return (
      <img
        src="/tokens/canton.webp"
        alt="Canton Coin icon"
        width={size}
        height={size}
        className={`token-icon ${className}`}
        style={{ borderRadius: '50%' }}
      />
    );
  }

  if (iconSrc === 'fallback') {
    return (
      <span
        className={`token-icon-fallback ${className}`}
        style={{
          width: size,
          height: size,
          fontSize: size * 0.6,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center'
        }}
      >
        {fallbackIcon}
      </span>
    );
  }

  if (iconSrc === 'local') {
    return (
      <img
        src={`/tokens/${lowerSymbol}.webp`}
        alt={`${symbol} icon`}
        width={size}
        height={size}
        className={`token-icon ${className}`}
        onError={() => setIconSrc('fallback')}
        style={{ borderRadius: '50%' }}
      />
    );
  }

  // Default: try web3icons CDN first
  return (
    <img
      src={`${WEB3ICONS_CDN}/${upperSymbol}.svg`}
      alt={`${symbol} icon`}
      width={size}
      height={size}
      className={`token-icon ${className}`}
      onError={() => setIconSrc('local')}
      style={{ borderRadius: '50%' }}
    />
  );
}

export default TokenIcon;
