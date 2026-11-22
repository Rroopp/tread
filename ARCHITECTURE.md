# Architecture

## Product shape

The platform is a multi-tenant financial connectivity layer. Institutions call a versioned API; the platform validates the request, applies eligibility and compliance controls, orchestrates provider work, records financial effects in its own ledger, reconciles outcomes, and reports status through API responses and signed webhooks.

## Initial deployment shape

Start with a modular NestJS monolith and explicit module boundaries. Keep provider execution behind one isolated worker process built from the same codebase; do not split into microservices until independent scaling, isolation, or ownership justifies the cost. Webhook delivery is already worker-based. The current provider mock is synchronous and is not the production worker architecture.

NestJS owns authoritative transaction rules and state transitions. Python may host a separately deployed, bounded service for a workload such as analytics or model-assisted risk signals. It must return advisory or explicitly versioned results; it must not post ledger entries or duplicate transaction state logic.

## Modules

1. Identity and access: users, sessions, authentication, roles, permissions.
2. Institutions and tenancy: onboarding, environments, limits, staff, credentials metadata.
3. Customers and compliance: KYC/KYB status, jurisdiction eligibility, screening cases.
4. Accounts and ledger: accounts, holds, balanced journal entries, reversals, statements.
5. Asset and currency registry: supported assets, networks, precision, jurisdiction availability.
6. Quotes and liquidity: provider quote adapters, expiry, eligible routing inputs.
7. Transaction orchestration: idempotency, explicit transition graph, durable per-step work, retries, timeouts, compensation, and reconciliation of uncertain outcomes.
8. Provider integrations: bank, payout, custody, liquidity, and blockchain adapters behind interfaces.
9. Webhooks and outbox: durable events, delivery attempts, signatures, replay protection.
10. Reconciliation and audit: provider references, statements/events, discrepancies, append-only audit records.
11. Internal operations: restricted administrative workflows, dual control for sensitive actions.

Modules communicate through typed application interfaces and domain events. Provider-specific data stays behind adapters and is normalized before reaching core transaction logic.

Provider contracts currently describe normalized bank rail, FX/liquidity, custody, blockchain, and compliance operations. The provider registry requires a registered concrete adapter whose capability and environment match the integration record; metadata alone never enables execution. No live adapters are currently registered. Provider secrets are resolved from managed-secret references by a future adapter layer and never loaded from the provider registry as raw values.

## Financial invariants

- PostgreSQL is authoritative for internal accounting records; provider and chain balances are external observations.
- Every posted journal transaction has at least two entries and sums to zero per currency.
- Amounts use integer minor units or PostgreSQL `NUMERIC` with explicit currency precision. Never use floating point.
- Posted ledger entries are immutable. Corrections use linked reversal or adjustment transactions.
- A database transaction atomically records journal entries, transaction state, idempotency result, and outbox events where applicable.
- External side effects must use durable per-step workflow state, provider-boundary idempotency, timeouts, safe retry classification, and reconciliation. Unknown outcome is terminal for automatic submission and must never be blindly retried. A database commit cannot make an external provider call atomic. The current mock persists operation/attempt state but executes synchronously and does not yet provide durable per-step worker scheduling.

## Data and messaging

Use PostgreSQL. Use relational constraints, foreign keys, unique idempotency scopes, and row locks for contested balance operations. Apply schema changes through versioned migrations. Use an outbox table in the same transaction as domain changes; workers publish and mark events for delivery. Current audit records share the business database and are not hash-chained or externally anchored; do not describe them as tamper-evident against privileged database access. Rate limiting currently uses PostgreSQL shared storage. Caches never become authoritative balances or transaction outcomes.

## Transaction lifecycle

Use guarded domain methods, not arbitrary status updates. Transaction-level states are supplemented by provider operation/attempt state; production workflows must also persist each step's state, deadline, retry disposition, and compensation. Persist transition actor, timestamp, reason, and provider reference. Institution limits, velocity controls, and maker-checker transfer approval are pre-live requirements and are not yet implemented. Compliance decisions currently gate selected state changes; a versioned policy engine remains future work.

## Environments

Sandbox and production are isolated environments with distinct credentials, provider configuration, limits, and data. Sandbox activity must be clearly labelled and cannot represent real settlement. Production routes require institution and jurisdiction enablement plus configured licensed providers.

## UI direction

The product surface is the versioned API and OpenAPI reference. Keep a thin institution operator console and restricted internal operations area; reports, usage, team management, standalone customer/beneficiary registries, and the interactive developer-console surface are deferred from pilot navigation. Usage data is not billing-grade. Keep client surfaces decoupled through the API. The TREAD design system uses a near-black editorial surface, signal lime, serif display type, Inter Tight UI, and monospace technical evidence; do not reintroduce the former cloud-white/pink palette.
