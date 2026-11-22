# API Conventions

## Design

Expose a versioned REST API under `/v1`. Publish an OpenAPI document generated from NestJS DTOs. Use explicit request schemas, stable error codes, correlation IDs, pagination, and UTC ISO-8601 timestamps. Do not expose provider credentials, internal risk signals, or unnecessary personal data.

## Authentication and scope

Institution API credentials are environment-specific and scoped. Store only a one-way hash of the presented secret and display the secret once at creation. Authenticate every request and enforce tenant and permission checks on every resource operation. Use separate sandbox and production base URLs or an equally strong environment boundary.

The initial implementation uses `Authorization: Bearer <key>` with generated `tr_sbx_...` or `tr_live_...` credentials. The database stores a SHA-256 hash of the high-entropy secret, not the plaintext. Transaction routes require `transactions:write` for creation and `transactions:read` for retrieval. Local seed commands are guarded to local development databases.

## Idempotency

Require an `Idempotency-Key` for financial create/execute endpoints. Scope the key to institution and endpoint family. Persist request fingerprint and result atomically with the initial operation. Same key and same payload returns the original outcome; same key with a different payload returns a conflict.

## Errors and asynchronous work

Use a stable error envelope with `error.code`, `error.message`, `request_id`, and optional field details. The API also returns an `X-Request-Id` response header. Return accepted responses for durable asynchronous processing with a transaction resource to poll. Lifecycle updates are also delivered through signed webhooks; webhook delivery is at least once, so consumers must deduplicate by event ID.

## Initial resource candidates

- `institutions` and institution environment setup (internal onboarding first).
- `accounts` and balance views (read-only until ledger controls are implemented).
- `quotes` with explicit expiry and asset/currency precision.
- `transactions` with idempotent creation and state history.
- `webhook-endpoints` and delivery event logs.

Implemented initial endpoints:

- `POST /v1/onboarding/institutions` — public, rate-limited request to begin KYB onboarding. It creates a `PENDING_REVIEW` institution and disabled sandbox environment; it does not verify identity or activate access.
- `POST /v1/auth/accept-invitation` — accepts a one-time, expiring invitation token and establishes/links a verified user password.
- `POST /v1/auth/login` — accepts email, password, and institution ID; returns a short-lived access token and rotating refresh token.
- `POST /v1/auth/refresh` — consumes a refresh token once and returns a replacement. Reuse revokes the session.
- `POST /v1/auth/logout` and `GET /v1/auth/me` — require a user access token.
- `GET /v1/institutions/current` — returns the authenticated user’s current institution and review state.
- `GET /v1/institutions/current/dashboard` — authenticated institution overview, balances, recent transactions, team count, and API credential count.
- `GET /v1/institutions/current/dashboard/transactions?status=&q=&limit=25&offset=0` — authenticated, tenant/environment-scoped transaction search and pagination.
- `GET /v1/institutions/current/dashboard/transactions/{transactionId}` — authenticated transaction details with lifecycle, compliance, provider-attempt, journal-entry, and reconciliation evidence.
- `GET /v1/institutions/current/dashboard/compliance?limit=50&offset=0` and `/dashboard/usage` — tenant-scoped compliance evidence and current-month operational counts. Usage is informational and is not a billable statement.
- `GET|POST /v1/institutions/current/customers` and `DELETE /v1/institutions/current/customers/{customerId}` — human JWT; creates encrypted pending customer records and disables without deleting history.
- `GET|POST /v1/institutions/current/beneficiaries` and `DELETE /v1/institutions/current/beneficiaries/{beneficiaryId}` — human JWT; creates encrypted pending destinations, returns masked values, and does not initiate payouts.
- `POST /v1/institutions/current/dashboard/quotes` and `/dashboard/transactions` — human JWT sandbox workflow for requesting a simulated quote and recording an idempotent transaction request; no funds move.
- `GET /v1/institutions/current/team` and `/team/invitations` — owner/admin only; list tenant members and pending invitations.
- `POST /v1/institutions/current/team/invitations` — owner/admin only; issues a one-time invite token. Owners may invite admins, operators, viewers, and compliance staff. Admins may invite operators and viewers.
- `DELETE /v1/institutions/current/team/invitations/{invitationId}` — owner/admin only; revoke a pending invitation.

- `POST /v1/transactions` — requires `transactions:write`, a `Idempotency-Key`, enabled `assetCode`, and positive integer `amountMinor` as a string. Returns a stored transaction in `CREATED` state.
- `GET /v1/transactions?limit=50` — requires `transactions:read`; returns up to 100 recent transaction request records for the credential's institution and environment.
- `GET /v1/transactions/{transactionId}` — requires `transactions:read`; returns the tenant-scoped request and its lifecycle history.
- `POST /v1/quotes` — requires `quotes:write`; creates a 60-second quote in `SANDBOX` only. Configured sandbox rates are simulated minor-unit ratios and responses are marked `SANDBOX_SIMULATED`. Production quote requests fail closed because no live liquidity provider is configured.
- `GET /v1/quotes/{quoteId}` — requires `quotes:read`; reads a quote restricted to the credential's institution and environment.
- `POST /v1/transactions/{transactionId}/sandbox-simulate-funding` — requires `transactions:sandbox_simulate`; sandbox only. Records simulated funding transitions and a configured simulated compliance outcome. It never moves or settles funds. `SANDBOX_COMPLIANCE_OUTCOME` defaults to `REVIEW`.
- `GET /v1/institutions/current/api-keys`, `POST /v1/institutions/current/api-keys`, and `DELETE /v1/institutions/current/api-keys/{credentialId}` — human JWT, owner/admin only. Key plaintext is returned only at creation; list responses contain prefixes and scopes.
- `GET /v1/institutions/current/webhooks/endpoints`, `POST /v1/institutions/current/webhooks/endpoints`, `DELETE /v1/institutions/current/webhooks/endpoints/{endpointId}`, and `GET /v1/institutions/current/webhooks/deliveries` — human JWT, owner/admin only; manages endpoints for the active sandbox environment.
- `GET /v1/internal/admin/overview`, `/institutions`, `/transactions`, `/compliance-queue`, and `/providers` — human JWT plus separate internal scopes; reads are audit logged.
- `POST /v1/internal/admin/providers/integrations` and `PATCH /v1/internal/admin/providers/integrations/{integrationId}/status` — requires `providers:write`; records provider metadata and managed secret references only. `CONFIGURED` does not enable execution.
- `POST /v1/webhooks/endpoints`, `GET /v1/webhooks/endpoints`, `DELETE /v1/webhooks/endpoints/{endpointId}`, and `GET /v1/webhooks/deliveries` — scoped API key access. Endpoint hostnames must exactly match `WEBHOOK_ALLOWED_HOSTS`; HTTPS is required. Signing secrets are encrypted at rest and returned once.
- `POST /v1/accounts` — requires `accounts:write`; creates an institution-owned `SETTLEMENT`, `FEE`, or `SUSPENSE` account for an enabled asset. Repeating the same account reference and settings returns the existing account; conflicting settings return a conflict.
- `GET /v1/accounts` and `GET /v1/accounts/{accountId}` — require `accounts:read`; return environment-scoped account records with normal balance, posted balance, available balance, debit/credit totals, and active holds.
- `POST /v1/accounts/{accountId}/holds` — requires `accounts:write` and `Idempotency-Key`; places a balance-backed hold.
- `POST /v1/accounts/{accountId}/holds/{holdId}/release` — requires `accounts:write`; releases an active hold. Capturing a hold is an internal ledger posting operation and must match the posted account reduction exactly.

Creation persists an initial lifecycle event and outbox event in the same database transaction. The webhook worker consumes supported outbox events and retries delivery. Transaction request creation still does not represent provider execution or settlement. Provider-backed transaction orchestration, live compliance screening, and live payment rails remain unimplemented.

Institution applications are reviewed through the restricted internal administration workflow. A reviewer records approve/reject and a reason; a different internal administrator must confirm activation. The decision and confirmation are audited. The old one-person approval utility has been removed. Invitations enter a durable outbox through a provider-neutral email interface. Development uses a console sender; production sends fail closed until a sender is configured.

Reconciliation batch processing is currently an internal service used by a future provider adapter. No public institution endpoint can mark provider evidence as authoritative or advance a transaction to `RECONCILED`.

Typed contracts cover bank rails, FX/liquidity, custody, blockchain, and compliance checks. A KES ↔ USDC mock exercises the simulated lifecycle and persists provider-boundary idempotency and attempt outcomes. An uncertain outcome is marked for reconciliation and is not blindly retried. The mock is not a live adapter and cannot move funds. Reconciliation consumes a statement-feed interface and classifies matched, variance, unmatched, and pending observations; no live feed is connected. Live execution remains unavailable until a selected licensed provider's sandbox has been validated and legal, compliance, limit, dual-control, security, reconciliation, and operating approvals are complete.

The dashboard's customer/beneficiary registries, team page, reports, usage view, and interactive developer console are deferred from the pilot navigation. Their routes and supporting APIs may remain available in this release; usage counts are informational, not billing-grade. Integrators should use the versioned API and generated OpenAPI reference. The source-of-funds evidence package is design-only; see `docs/EVIDENCE_PACKAGE_SCHEMA_PLAN.md` for its proposed schema and migration plan.
