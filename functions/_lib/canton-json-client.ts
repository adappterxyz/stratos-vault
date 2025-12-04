import * as jwt from 'jsonwebtoken';

export interface CantonJsonConfig {
  host: string;
  port: number;
  authSecret: string;
  authUser: string;
  authAudience: string;
}

export interface PartyDetails {
  party: string;
  displayName: string;
  isLocal: boolean;
}

export interface User {
  id: string;
  primaryParty: string;
  isDeactivated: boolean;
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
        exp: Math.floor(Date.now() / 1000) + (60 * 60)
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
      throw new Error(`Canton JSON API error: ${response.status} - ${errorText}`);
    }

    return response.json() as Promise<T>;
  }

  async getParticipantId(): Promise<string> {
    const result = await this.fetch<{ participantId: string }>('/parties/participant-id');
    return result.participantId;
  }

  async allocateParty(partyIdHint: string, displayName: string): Promise<PartyDetails> {
    const result = await this.fetch<any>('/parties', {
      method: 'POST',
      body: JSON.stringify({
        partyIdHint,
        displayName,
        identityProviderId: ''
      })
    });

    console.log('allocateParty raw result:', JSON.stringify(result));
    console.log('allocateParty result keys:', Object.keys(result));

    // Canton JSON API v2 may return different structures
    // Try various possible response formats
    let party = '';
    let resultDisplayName = displayName;
    let isLocal = true;

    if (result.partyDetails) {
      // Nested partyDetails object
      const pd = result.partyDetails;
      party = pd.party || pd.partyId || pd.identifier || '';
      resultDisplayName = pd.displayName || displayName;
      isLocal = pd.isLocal ?? true;
      console.log('Found partyDetails nested:', JSON.stringify(pd));
    } else if (result.party) {
      // Direct party field
      party = result.party;
      resultDisplayName = result.displayName || displayName;
      isLocal = result.isLocal ?? true;
      console.log('Found direct party field:', party);
    } else if (result.partyId) {
      // Direct partyId field
      party = result.partyId;
      resultDisplayName = result.displayName || displayName;
      isLocal = result.isLocal ?? true;
      console.log('Found direct partyId field:', party);
    } else if (result.identifier) {
      // Some Canton versions use identifier
      party = result.identifier;
      resultDisplayName = result.displayName || displayName;
      isLocal = result.isLocal ?? true;
      console.log('Found identifier field:', party);
    } else {
      console.log('Could not find party in result, dumping all fields:');
      for (const [key, value] of Object.entries(result)) {
        console.log(`  ${key}: ${JSON.stringify(value)}`);
      }
    }

    console.log('Final extracted party:', party);

    return {
      party,
      displayName: resultDisplayName,
      isLocal
    };
  }

  async createUser(userId: string, primaryParty: string, displayName: string): Promise<User> {
    const result = await this.fetch<{ user: User }>('/users', {
      method: 'POST',
      body: JSON.stringify({
        user: {
          id: userId,
          isDeactivated: false,
          primaryParty: primaryParty,
          identityProviderId: '',
          metadata: {
            resourceVersion: '',
            annotations: {
              username: displayName
            }
          }
        },
        rights: []
      })
    });
    return result.user;
  }

  async grantRights(userId: string, partyId: string): Promise<void> {
    await this.fetch(`/users/${userId}/rights`, {
      method: 'POST',
      body: JSON.stringify({
        userId,
        identityProviderId: '',
        rights: [
          { kind: { CanActAs: { value: { party: partyId } } } },
          { kind: { CanReadAs: { value: { party: partyId } } } }
        ]
      })
    });
  }

  async listParties(): Promise<PartyDetails[]> {
    const result = await this.fetch<{ partyDetails: PartyDetails[] }>('/parties');
    return result.partyDetails;
  }

  async uploadDar(darBytes: ArrayBuffer, darName: string): Promise<{ mainPackageId: string }> {
    const token = this.generateToken();
    // DAR upload goes to a different endpoint
    const url = `${this.baseUrl}/packages`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/octet-stream',
        'Dar-Name': darName
      },
      body: darBytes
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`DAR upload error: ${response.status} - ${errorText}`);
    }

    return response.json() as Promise<{ mainPackageId: string }>;
  }

  async listPackages(): Promise<string[]> {
    const result = await this.fetch<{ packageIds: string[] }>('/packages');
    return result.packageIds || [];
  }

  // ============================================
  // Generic Contract Operations (JSON API v2)
  // ============================================

  /**
   * Get current ledger end offset
   */
  async getLedgerEnd(): Promise<string> {
    const result = await this.fetch<{ offset: string }>('/state/ledger-end');
    return result.offset;
  }

  /**
   * Query active contracts by template ID
   * Note: JSON API v2 doesn't support query-by-attribute, so we filter client-side
   */
  async queryContracts(
    actAs: string,
    templateId: string,
    filter?: Record<string, unknown>
  ): Promise<Array<{
    contractId: string;
    templateId: string;
    payload: Record<string, unknown>;
    createdAt?: string;
    signatories?: string[];
    observers?: string[];
  }>> {
    // Get current ledger offset
    const offset = await this.getLedgerEnd();

    // Canton JSON API v2 active-contracts query format
    // templateId should be a string in format "packageId:moduleName:entityName"
    const queryBody = {
      filter: {
        filtersByParty: {
          [actAs]: {
            cumulative: [
              {
                identifierFilter: {
                  TemplateFilter: {
                    value: {
                      templateId,
                      includeCreatedEventBlob: false
                    }
                  }
                }
              }
            ]
          }
        }
      },
      verbose: true,
      activeAtOffset: offset
    };

    const result = await this.fetch<Array<{
      workflowId: string;
      contractEntry: {
        JsActiveContract: {
          createdEvent: {
            contractId: string;
            templateId: string;
            createArgument: Record<string, unknown>;
            signatories: string[];
            observers: string[];
            createdAt: string;
          }
        }
      }
    }>>(
      '/state/active-contracts',
      {
        method: 'POST',
        body: JSON.stringify(queryBody)
      }
    );

    // Transform and filter results
    let contracts = (result || []).map(c => ({
      contractId: c.contractEntry.JsActiveContract.createdEvent.contractId,
      templateId,
      payload: c.contractEntry.JsActiveContract.createdEvent.createArgument,
      createdAt: c.contractEntry.JsActiveContract.createdEvent.createdAt,
      signatories: c.contractEntry.JsActiveContract.createdEvent.signatories,
      observers: c.contractEntry.JsActiveContract.createdEvent.observers
    }));

    // Client-side filtering if filter provided
    if (filter && Object.keys(filter).length > 0) {
      contracts = contracts.filter(contract => {
        return Object.entries(filter).every(([key, value]) => {
          return contract.payload[key] === value;
        });
      });
    }

    return contracts;
  }

  /**
   * Create a new contract using submit-and-wait-for-transaction
   */
  async createContract(
    actAs: string,
    templateId: string,
    payload: Record<string, unknown>
  ): Promise<{ contractId: string }> {
    const commandId = crypto.randomUUID();
    const result = await this.fetch<{
      transaction: {
        events: Array<{
          CreatedEvent?: {
            contractId: string;
          }
        }>
      }
    }>(
      '/commands/submit-and-wait-for-transaction',
      {
        method: 'POST',
        body: JSON.stringify({
          commands: {
            commands: [
              {
                CreateCommand: {
                  templateId,
                  createArguments: payload
                }
              }
            ],
            commandId,
            actAs: [actAs],
            readAs: [actAs]
          }
        })
      }
    );

    // Extract contract ID from created event
    const createdEvent = result.transaction?.events?.find(e => e.CreatedEvent);
    if (!createdEvent?.CreatedEvent?.contractId) {
      throw new Error('Contract creation did not return a contract ID');
    }

    return { contractId: createdEvent.CreatedEvent.contractId };
  }

  /**
   * Exercise a choice on a contract
   */
  async exerciseChoice(
    actAs: string,
    contractId: string,
    templateId: string,
    choice: string,
    argument: Record<string, unknown>
  ): Promise<{ exerciseResult: unknown; events?: Array<{ contractId: string; templateId: string; payload: Record<string, unknown> }> }> {
    const commandId = crypto.randomUUID();
    const result = await this.fetch<{
      transaction: {
        events: Array<{
          ExercisedEvent?: {
            exerciseResult: unknown;
          };
          CreatedEvent?: {
            contractId: string;
            templateId: string;
            createArgument: Record<string, unknown>;
          }
        }>
      }
    }>(
      '/commands/submit-and-wait-for-transaction',
      {
        method: 'POST',
        body: JSON.stringify({
          commands: {
            commands: [
              {
                ExerciseCommand: {
                  templateId,
                  contractId,
                  choice,
                  choiceArgument: argument
                }
              }
            ],
            commandId,
            actAs: [actAs],
            readAs: [actAs]
          }
        })
      }
    );

    // Extract exercise result
    const exercisedEvent = result.transaction?.events?.find(e => e.ExercisedEvent);
    const createdEvents = result.transaction?.events?.filter(e => e.CreatedEvent) || [];

    return {
      exerciseResult: exercisedEvent?.ExercisedEvent?.exerciseResult,
      events: createdEvents.map(e => ({
        contractId: e.CreatedEvent!.contractId,
        templateId: e.CreatedEvent!.templateId,
        payload: e.CreatedEvent!.createArgument
      }))
    };
  }
}
