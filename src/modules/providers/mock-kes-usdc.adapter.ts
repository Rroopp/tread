import { ForbiddenException, Injectable } from '@nestjs/common';
import { CorridorStage, CorridorStageResult, KesUsdcSandboxAdapter, ProviderContext } from './provider-contracts';

/** A deterministic simulator. It has no network, custody, banking, or ledger capability. */
@Injectable()
export class MockKesUsdcAdapter implements KesUsdcSandboxAdapter {
  readonly code = 'tread_mock_kes_usdc';

  async runStage(input: {
    context: ProviderContext;
    stage: CorridorStage;
    sourceAssetCode: 'KES' | 'USDC';
    destinationAssetCode: 'KES' | 'USDC';
    sourceAmountMinor: string;
    attemptNumber: number;
    scenario: 'SUCCESS' | 'FAIL_PAYOUT_AND_REVERSE' | 'FAIL_AT_STAGE' | 'TIMEOUT_AT_STAGE' | 'RETRYABLE_PAYOUT_ONCE';
    failAt?: CorridorStage;
  }): Promise<CorridorStageResult> {
    if (input.context.environment !== 'SANDBOX') {
      throw new ForbiddenException('The mock KES/USDC adapter is sandbox-only');
    }
    const stage = input.stage;
    const atRequestedFailure = input.failAt === stage;
    const timeout = input.scenario === 'TIMEOUT_AT_STAGE' && atRequestedFailure;
    const deterministicRetry = input.scenario === 'RETRYABLE_PAYOUT_ONCE' && stage === 'PAYOUT' && input.attemptNumber === 1;
    const failedPayout = input.scenario === 'FAIL_PAYOUT_AND_REVERSE' && stage === 'PAYOUT';
    const failedStage = input.scenario === 'FAIL_AT_STAGE' && atRequestedFailure;
    const outcome = timeout ? 'UNKNOWN' : deterministicRetry || failedPayout || failedStage ? 'FAILED' : 'SUCCEEDED';
    const retryDisposition = timeout ? 'DO_NOT_RETRY' : deterministicRetry ? 'SAFE_TO_RETRY' : outcome === 'FAILED' ? 'DO_NOT_RETRY' : 'NOT_APPLICABLE';
    return {
      stage,
      outcome,
      providerReference: timeout ? null : `mock-${input.context.correlationId}-${stage.toLowerCase()}-${input.attemptNumber}`,
      errorCode: timeout ? 'MOCK_TIMEOUT_OUTCOME_UNKNOWN' : deterministicRetry ? 'MOCK_TRANSIENT_REJECTION' : failedPayout ? 'MOCK_PAYOUT_REJECTED' : failedStage ? 'MOCK_STAGE_REJECTED' : null,
      retryDisposition,
      assetCode: stage === 'PAYOUT' ? input.destinationAssetCode : stage === 'CONVERSION' ? input.destinationAssetCode : null,
      amountMinor: stage === 'PAYOUT' || stage === 'CONVERSION' ? input.sourceAmountMinor : null,
      simulated: true,
      metadata: {
        corridor: 'KES_USDC',
        environment: 'SANDBOX',
        stage,
        demoOnly: true,
        ...(stage === 'QUOTE' ? {
          demoRateNumerator: '1', demoRateDenominator: '1', demoFeeMinor: '0',
          calculationNote: 'fixed identity-rate test fixture; not a market quote or fee schedule',
        } : {}),
        noFundsMoved: true,
        uncertainOutcome: timeout,
      },
      occurredAt: new Date().toISOString(),
    };
  }
}
