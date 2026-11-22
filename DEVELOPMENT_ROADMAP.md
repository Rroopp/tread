# Development Roadmap

## Product focus

The first target customers are fintechs and payment companies, followed by banks. The first corridor is KES ↔ USDC through one licensed third-party provider. TREAD coordinates software workflows and evidence; it does not custody customer assets. Real-estate and other tokenized-asset products are out of scope. No live provider is connected and no funds move.

## Phase 0: Foundation and decisions

- Repository baseline, environment configuration, NestJS modular monolith, PostgreSQL local Compose, versioned API bootstrap, Swagger, health endpoints, and SQL migration runner. (Implemented.)
- Initial institution, environment, API credential, transaction, idempotency, outbox, audit, account, journal, and ledger schemas. (Implemented.)
- Scoped API key authentication and idempotent sandbox transaction create/list/read APIs with lifecycle history. (Implemented.)
- Public institution application, reasoned review, two-person activation confirmation, one-time invitations, human login, refresh rotation/reuse revocation, and current-institution view. (Implemented; production email delivery still requires a configured provider-neutral sender.)
- Owner/admin TOTP MFA with hashed one-time recovery codes, role-limited team invitations, and invitation revocation. (Implemented.)
- Architecture, security, database, API, and operational conventions.
- Resolve deployment target, exact palette swatches and contrast pairs, identity provider, and initial institution onboarding workflow.

## Phase 1: Secure platform foundation

- API key authentication, transaction scopes, tenant/environment isolation, append-only audit and lifecycle history. (Initial pieces implemented.)
- Institution onboarding, staff/roles, production API credential lifecycle, sandbox boundary. (Application intake, development review, and owner/admin team invitation controls implemented.)
- Currency/asset registry and accounts. (Base registry, institution-scoped operational account provisioning, ledger-derived posted/available balances, active holds, and account dashboard view implemented; customer ownership remains.)
- Double-entry ledger schema and posting service, holds, reversals, and idempotency. (Balanced posting, account normal balances, hold-aware funds checks, hold capture/release, linked reversals, and content-checked idempotency implemented.)
- OpenAPI and developer sandbox. (Swagger, local sandbox seed, getting-started guide, and quote/request API implemented. Integrators use the API and OpenAPI reference; the dashboard sandbox console is deferred.)

## Phase 2: Transaction engine

- Quotes, explicit transaction state machine, outbox, workers, provider interfaces. (Sandbox-simulated quote storage and single-use quote consumption, state guards, status-change outbox events, and typed provider contracts are implemented. The KES ↔ USDC mock lifecycle is persisted and explicitly simulated; provider orchestration is currently synchronous, not a durable per-step worker.)
- Provider attempt tracking, retry and failure recovery, signed webhooks. (Provider-boundary idempotency and unknown-outcome-to-reconciliation behavior exist in the mock execution service. Signed webhook delivery has retry/backoff. No live provider execution is connected.)
- Reconciliation framework and exception handling. (Statement-feed interface, append-only observations, and matched/variance/unmatched/pending classification are implemented; no live feed is connected.)
- Compliance and jurisdiction gates in the execution path. (Latest environment-matched decisions gate guarded state changes. A versioned, configurable policy engine and live screening providers remain outstanding.)

## Phase 3: First corridor (subject to licensing and partners)

- KES and USD/USDC corridor design and provider sandbox integrations.
- Deposit, conversion, withdrawal/payout, settlement tracking, reconciliation.
- Verify every provider flow in a real partner sandbox before describing it as integrated.
- Enable production only after security, compliance, operations, and partner approval gates.

## Phase 4: Institutional operations

- Initial institutional console and onboarding application form. (The console is a thin workspace for transaction, account, compliance, API credential, webhook, and restricted operations views. OpenAPI and the versioned API are the integrator-facing product.)
- Reports, usage, developer console, standalone customer/beneficiary screens, and team-management page are deferred from the pilot navigation. Supporting APIs and stored records remain in the codebase; usage is not billing-grade, and customer/beneficiary data is not verification evidence by itself.
- Internal administration has separate platform scopes, audited views, and provider metadata configuration. Institution activation uses two-person review. Transfer limits and maker-checker approval are not implemented.

Customer and beneficiary records are tenant/environment scoped and encrypted at rest. New customers and destinations remain pending verification; there is no payout initiation workflow until screening and payment providers are integrated. The source-of-funds evidence schema is documented in `docs/EVIDENCE_PACKAGE_SCHEMA_PLAN.md` and remains design-only pending review of retention and evidence-access policy.

## Phase 5: Expansion

- One licensed provider for the first KES ↔ USDC corridor, after partner documentation, sandbox validation, legal scope, operational controls, and credentials are supplied. Additional providers/corridors follow only after the first is validated.
- Introduce Go only for a measured performance/concurrency need; keep authoritative business rules singular.
- Consider Kafka/Temporal only when event volume or workflow complexity justifies the operational cost.

## Deferred / out of scope

- Real-estate/property tokenization and other tokenized-asset products are out of scope.
- Live transfer execution is blocked on a selected licensed partner, partner documentation, and legal, risk, compliance, and operational approval.
- Institution amount/velocity limits and maker-checker transfer approval must be designed before any live financial execution.
- Provider calls need an isolated durable worker with explicit persisted workflow-step state before live provider traffic. Unknown outcomes must remain reconciliation-bound and never be retried blindly.
- Audit logs currently share the business PostgreSQL database and are not hash-chained or externally anchored.
- A configurable/versioned compliance policy engine remains future work; current enforcement uses recorded decisions and database gates.

## Quality gates

Prioritize automated verification for balanced ledger posting, concurrent operations, duplicate requests, valid state transitions, authorization, tenant isolation, provider failure recovery, webhook signatures, and reconciliation. State-machine tests and disposable-database ledger, compliance, and reconciliation integration tests are implemented. Provider sandbox and webhook delivery tests remain outstanding. Migrations are applied to the local PostgreSQL database. No payment, liquidity, custody, or banking provider is integrated.
