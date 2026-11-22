# Provider onboarding inputs

TREAD has no live banking, FX, custody, blockchain, or screening adapter. The KES/USDC implementation in this repository is a deterministic sandbox simulator. Its fixed identity-rate and zero-fee fixture are test data, not a market quote, fee schedule, or claim about a partner. It never moves funds or posts ledger entries.

The first production corridor is intended to use one licensed third-party provider. Before implementing a live adapter, provide the following for the specific provider you select. Do not send credentials in chat, email, tickets, or source control; provision them through the production secrets manager and provide only the secret reference and access policy.

## 1. Provider identity and permission scope

- Provider legal entity name, contracting entity, and operating jurisdictions.
- Current licensing/registration evidence and the exact licensed activities covering KES collection/payout, USDC conversion, custody or asset control, and any screening services in the proposed flow.
- Written confirmation of which entity receives/controls each asset at every step, whether customer assets are ever held by TREAD, and the provider's safeguarding/segregation arrangement.
- Supported KES↔USDC direction(s), eligible customer/institution types, restrictions, and the provider's geographic/counterparty limits.
- Named compliance, technical integration, incident, and settlement operations contacts, including escalation hours and severity process.

TREAD will not infer licensing scope from marketing material. The provider and your counsel/compliance owners must confirm that the proposed operating model is permitted.

## 2. Sandbox documentation and technical behavior

Provide the provider's current sandbox documentation and, where available, a test tenant. The documentation must specify:

- Sandbox base URL(s), API version and deprecation policy, supported content types, request/response schemas, field lengths, amount precision, currency/network identifiers, and error catalog.
- Authentication method, key rotation process, signing/canonicalization rules, certificate requirements, IP controls, and how credentials are scoped.
- Quote request/response semantics: supported pairs, rate representation, fees/spread, quote expiry, price guarantees, rounding, minimum/maximum sizes, and whether a quote reserves liquidity.
- Funding/collection confirmation, conversion, payout, and reversal/return operations, including allowed state transitions and whether each operation is synchronous or asynchronous.
- Idempotency guarantees and retention period; behavior when the same key has a different request; provider-reference uniqueness; status lookup/query behavior.
- Timeout, connection reset, duplicate submission, delayed response, partial completion, and unknown-outcome behavior. We need a documented lookup or statement path to resolve a request that may have succeeded after TREAD timed out.
- Supported test scenarios, deterministic test accounts/beneficiaries, sample statements, and provider-provided expected outcomes.

Do not supply an undocumented endpoint or ask TREAD to infer a provider request format. Adapter code will follow the provider's actual documentation.

## 3. Credentials and secret references

After choosing the deployment secrets manager, provision separate sandbox and production secrets and send only:

- Secret-manager reference for each credential set (never the secret value).
- Runtime workload identity/service account allowed to read it, exact environment, rotation owner, expiry/rotation schedule, and emergency revocation procedure.
- Required non-secret configuration such as tenant/account IDs, API version, and certificate names.
- Whether webhook verification uses a separate secret or public key and the corresponding reference/rotation metadata.

Production and sandbox credentials must be separate. The adapter must not return or log secret values.

## 4. Webhooks and event delivery

Provide the authoritative webhook specification:

- Event names and exact payload schemas for quote, funding confirmation, compliance result, conversion, payout, return/reversal, and settlement/statement availability.
- Signature algorithm, signed bytes/canonicalization, key identifier and rotation, timestamp tolerance, replay identifiers, and verification test vectors.
- Delivery retry schedule, maximum retention, ordering guarantees, duplicate behavior, and how to request redelivery.
- Provider webhook source IP ranges or mTLS details if available. TREAD will still verify signatures and will not rely on source IP alone.

## 5. Fees, rails, and settlement evidence

- Contracted fee schedule, FX spread/markup, taxes, network fees, minimums, maximums, quote validity, fee payer, and effective dates. Confirm how fees change by amount, rail, time, and customer class.
- Supported Kenyan collection and payout rails, required beneficiary fields, account-name checks, supported banks/mobile-money networks, operating hours, cutoffs, limits, and return/recall rules.
- Settlement and reconciliation schedule, statement delivery method, file/API format, timezone, currency precision, reference mapping, correction/adjustment records, and expected latency.
- A mapping from every provider status and statement line to confirmed success, confirmed failure, pending, variance, or unknown. Confirm how late, duplicate, and corrected evidence is identified.

## 6. Compliance and source-of-funds requirements

- Screening products actually provided (KYC/KYB, sanctions, PEP, AML, wallet/address screening, travel rule) and what the provider does not cover.
- Exact request fields, decision values, reason codes, review/escalation process, timestamp/version fields, and whether a decision is a binding provider decision or only a signal.
- Required source-of-funds/source-of-wealth evidence fields and document types for the intended customer segment and transaction sizes; evidence acceptance criteria and who makes the final decision.
- Data residency, subprocessors, retention/deletion, permitted use, breach notice, and audit/export requirements for identity and financial data.
- Sandbox fixtures and test cases for allow, deny, review, stale screening, mismatched identity, sanctions hit, and provider outage.

TREAD will label provider decisions with their actual source and mode. A simulated or incomplete decision will never be presented as a live verification.

## 7. Test and operational acceptance

Before enabling a production adapter, the provider and TREAD operators must be able to demonstrate in sandbox:

- Idempotent quote and execution replay; duplicate and mismatched idempotency requests.
- Confirmed funding, compliance allow/deny/review, successful conversion and payout, provider rejection, reversal/return, and timeout after a possibly accepted request.
- Statement-feed reconciliation for matched, variance, unmatched, and pending rows, including an unknown attempt that must not be silently resubmitted.
- Credential rotation, webhook signature rotation/replay rejection, rate limits, timeout behavior, alerting, escalation, and operational recovery.

Production enablement additionally requires reviewed legal/compliance approval, secret-manager references and least-privilege access, an approved fee/limit configuration, tested reconciliation ownership, incident contacts, and explicit operational sign-off. Provider metadata or a configured secret reference alone will not enable live execution.

## What to send TREAD to begin

1. The selected provider's legal entity and the operating model you want for the KES↔USDC corridor.
2. Current sandbox integration documentation and sample webhook/statement payloads.
3. A statement of supported KES rails, USDC network(s), direction(s), and provider services for funding, conversion, payout, and screening.
4. Contracted fee/spread schedule and quote/settlement rules.
5. The secret-manager product, sandbox secret references, workload identity policy, and the owner who will rotate/revoke them.
6. The compliance owner who will approve required source-of-funds evidence and screening outcomes.

Do not provide production credential values until a specific provider adapter is implemented and the deployment's secret-manager identity and release controls have been reviewed. No real adapter will be started before the sandbox documents and operating scope above are supplied.
