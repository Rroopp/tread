export type ProviderEnvironment = 'SANDBOX' | 'PRODUCTION';
export type ProviderCapability = 'BANK_RAIL' | 'FX_LIQUIDITY' | 'CUSTODY' | 'BLOCKCHAIN' | 'KYC_KYB' | 'AML_SANCTIONS' | 'TRAVEL_RULE';

export interface ProviderContext {
  institutionId: string;
  environmentId: string;
  environment: ProviderEnvironment;
  transactionId: string;
  idempotencyKey: string;
  correlationId: string;
  /** Absolute timeout for one adapter request; callers must map expiry to UNKNOWN. */
  timeoutMs: number;
}

/** UNKNOWN means the provider may have acted; callers must reconcile and must not resubmit. */
export interface ProviderResult {
  providerReference: string | null;
  status: 'ACCEPTED' | 'PENDING' | 'SUCCEEDED' | 'REJECTED' | 'UNKNOWN';
  assetCode: string | null;
  amountMinor: string | null;
  errorCode: string | null;
  retryDisposition: 'SAFE_TO_RETRY' | 'DO_NOT_RETRY' | 'NOT_APPLICABLE';
  observedAt: string;
  metadata: Record<string, string | number | boolean | null>;
}

export interface ProviderQuote {
  providerReference: string;
  sourceAssetCode: string;
  sourceAmountMinor: string;
  destinationAssetCode: string;
  destinationAmountMinor: string;
  feeAssetCode: string;
  feeAmountMinor: string;
  rateNumerator: string;
  rateDenominator: string;
  expiresAt: string;
}

export type ProviderScreeningResult = {
  decision: 'ALLOW' | 'DENY' | 'REVIEW';
  providerReference: string;
  checkedAt: string;
  reasonCode: string | null;
};

export interface FxLiquidityProvider {
  readonly code: string;
  quote(context: ProviderContext, sourceAsset: string, destinationAsset: string, amountMinor: string): Promise<ProviderQuote>;
  execute(context: ProviderContext, quoteReference: string): Promise<ProviderResult>;
}

export interface BankRailProvider {
  readonly code: string;
  collect(context: ProviderContext, assetCode: string, amountMinor: string, accountReference: string): Promise<ProviderResult>;
  payout(context: ProviderContext, assetCode: string, amountMinor: string, beneficiaryReference: string): Promise<ProviderResult>;
  getStatus(context: ProviderContext, providerReference: string): Promise<ProviderResult>;
}

export interface CustodyProvider {
  readonly code: string;
  createDepositAddress(context: ProviderContext, assetCode: string, network: string): Promise<{ address: string; providerReference: string }>;
  transfer(context: ProviderContext, assetCode: string, amountMinor: string, destination: string, network: string): Promise<ProviderResult>;
  getStatus(context: ProviderContext, providerReference: string): Promise<ProviderResult>;
}

export interface BlockchainProvider {
  readonly code: string;
  validateAddress(assetCode: string, network: string, address: string): Promise<{ valid: boolean; reason?: string }>;
  broadcast(context: ProviderContext, signedPayloadReference: string): Promise<ProviderResult>;
  confirmations(context: ProviderContext, transactionReference: string): Promise<{ confirmations: number; required: number; status: 'PENDING' | 'CONFIRMED' | 'FAILED' }>;
}

export interface ComplianceProvider {
  readonly code: string;
  readonly capability: 'KYC_KYB' | 'AML_SANCTIONS' | 'TRAVEL_RULE';
  screen(context: ProviderContext, subjectReference: string, checkTypes: Array<'KYC' | 'KYB' | 'AML' | 'SANCTIONS' | 'PEP' | 'JURISDICTION'>): Promise<ProviderScreeningResult>;
}

export type CorridorStage = 'QUOTE' | 'FUNDING_CONFIRMATION' | 'COMPLIANCE' | 'CONVERSION' | 'PAYOUT' | 'REVERSAL';
export type CorridorOutcome = 'SUCCEEDED' | 'FAILED' | 'UNKNOWN';

export interface CorridorStageResult {
  stage: CorridorStage;
  outcome: CorridorOutcome;
  providerReference: string | null;
  errorCode: string | null;
  retryDisposition: 'SAFE_TO_RETRY' | 'DO_NOT_RETRY' | 'NOT_APPLICABLE';
  assetCode: string | null;
  amountMinor: string | null;
  simulated: true;
  metadata: Record<string, string | number | boolean | null>;
  occurredAt: string;
}

export interface KesUsdcSandboxAdapter {
  readonly code: string;
  runStage(input: {
    context: ProviderContext;
    stage: CorridorStage;
    sourceAssetCode: 'KES' | 'USDC';
    destinationAssetCode: 'KES' | 'USDC';
    sourceAmountMinor: string;
    attemptNumber: number;
    scenario: 'SUCCESS' | 'FAIL_PAYOUT_AND_REVERSE' | 'FAIL_AT_STAGE' | 'TIMEOUT_AT_STAGE' | 'RETRYABLE_PAYOUT_ONCE';
    failAt?: CorridorStage;
  }): Promise<CorridorStageResult>;
}

export type ProviderAdapter = FxLiquidityProvider | BankRailProvider | CustodyProvider | BlockchainProvider | ComplianceProvider;
export const PROVIDER_ADAPTERS = Symbol('PROVIDER_ADAPTERS');
export const MOCK_KES_USDC_ADAPTER = Symbol('MOCK_KES_USDC_ADAPTER');

export function providerCapability(adapter: ProviderAdapter): ProviderCapability {
  if ('quote' in adapter) return 'FX_LIQUIDITY';
  if ('collect' in adapter) return 'BANK_RAIL';
  if ('createDepositAddress' in adapter) return 'CUSTODY';
  if ('confirmations' in adapter) return 'BLOCKCHAIN';
  return adapter.capability;
}
