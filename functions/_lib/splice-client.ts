import * as jwt from 'jsonwebtoken';

export interface SpliceConfig {
  validatorHost: string;
  validatorPort: number;
  authSecret: string;
  authUser: string;
  authAudience: string;
}

export interface WalletBalance {
  round: number;
  effective_unlocked_qty: string;
  effective_locked_qty: string;
  total_holding_fees: string;
}

export interface Transaction {
  transaction_type: string;
  transaction_subtype: {
    template_id: string;
    choice: string;
    amulet_operation: string | null;
    interface_id: string | null;
  };
  event_id: string;
  date: string;
  provider: string;
  sender: {
    party: string;
    amount: string;
  };
  receivers: Array<{
    party: string;
    amount: string;
  }>;
  holding_fees: string;
  amulet_price: string;
  app_rewards_used: string;
  validator_rewards_used: string;
  sv_rewards_used: string;
  transfer_instruction_receiver: string | null;
  transfer_instruction_amount: string | null;
  transfer_instruction_cid: string | null;
  description: string | null;
}

export interface TransactionsResponse {
  items: Transaction[];
}

export interface UserStatus {
  party_id: string;
  user_onboarded: boolean;
  user_wallet_installed: boolean;
  has_featured_app_right: boolean;
}

export interface RegisterResponse {
  party_id: string;
}

export class SpliceClient {
  private config: SpliceConfig;
  private baseUrl: string;

  constructor(config: SpliceConfig) {
    this.config = config;
    const protocol = config.validatorPort === 443 ? 'https' : 'http';
    const port = config.validatorPort === 443 ? '' : `:${config.validatorPort}`;
    this.baseUrl = `${protocol}://${config.validatorHost}${port}/api/validator/v0`;
  }

  private generateToken(): string {
    return jwt.sign(
      {
        aud: this.config.authAudience,
        sub: this.config.authUser,
        exp: Math.floor(Date.now() / 1000) + (60 * 60) // 1 hour
      },
      this.config.authSecret,
      { algorithm: 'HS256' }
    );
  }

  private async fetch<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const token = this.generateToken();
    const url = `${this.baseUrl}${endpoint}`;

    const response = await fetch(url, {
      ...options,
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...options.headers
      }
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Splice API error: ${response.status} - ${errorText}`);
    }

    return response.json() as Promise<T>;
  }

  async register(): Promise<RegisterResponse> {
    return this.fetch<RegisterResponse>('/register', {
      method: 'POST'
    });
  }

  async getUserStatus(): Promise<UserStatus> {
    return this.fetch<UserStatus>('/wallet/user-status');
  }

  async getBalance(): Promise<WalletBalance> {
    return this.fetch<WalletBalance>('/wallet/balance');
  }

  async getTransactions(pageSize: number = 50): Promise<TransactionsResponse> {
    return this.fetch<TransactionsResponse>('/wallet/transactions', {
      method: 'POST',
      body: JSON.stringify({ page_size: pageSize })
    });
  }

  async createTransferOffer(receiver: string, amount: string, description?: string): Promise<any> {
    // Set expiration to 1 hour from now (in microseconds for Canton)
    const expiresAtMicros = (Date.now() + 60 * 60 * 1000) * 1000;

    // Generate unique tracking ID
    const trackingId = `transfer-${Date.now()}-${Math.random().toString(36).substring(7)}`;

    return this.fetch('/wallet/transfer-offers', {
      method: 'POST',
      body: JSON.stringify({
        receiver_party_id: receiver,
        amount,
        description,
        expires_at: expiresAtMicros.toString(),
        tracking_id: trackingId
      })
    });
  }

  async tap(amount: string): Promise<any> {
    return this.fetch('/wallet/tap', {
      method: 'POST',
      body: JSON.stringify({ amount })
    });
  }

  async listTransferOffers(): Promise<any> {
    return this.fetch('/wallet/transfer-offers', {
      method: 'GET'
    });
  }

  async acceptTransferOffer(contractId: string): Promise<any> {
    return this.fetch(`/wallet/transfer-offers/${contractId}/accept`, {
      method: 'POST',
      body: JSON.stringify({})
    });
  }

  async onboardUser(partyId: string, name: string): Promise<any> {
    return this.fetch('/admin/users', {
      method: 'POST',
      body: JSON.stringify({
        party_id: partyId,
        name: name
      })
    });
  }

  async listUsers(): Promise<Array<{ party_id: string; name: string }>> {
    const result = await this.fetch<{ users: Array<{ party_id: string; name: string }> } | Array<{ party_id: string; name: string }>>('/admin/users', {
      method: 'GET'
    });
    // Handle both { users: [...] } and direct array response formats
    if (Array.isArray(result)) {
      return result;
    }
    return result.users || [];
  }
}
