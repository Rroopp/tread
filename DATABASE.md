# Database Design

## Engine and conventions

PostgreSQL is the primary database. Use migrations, UTC timestamps (`timestamptz`), UUID identifiers for externally visible records, foreign keys, explicit unique constraints, and indexes derived from query patterns. Use `NUMERIC(precision, scale)` or integer minor units for money; each amount must be associated with a currency and its defined precision. No floating-point financial values.

Use Prisma for ordinary data access if it fits the selected NestJS setup. Use reviewed SQL transactions for ledger posting, row locking, and other operations where correctness depends on database-specific behavior.

## Tenant isolation

Tenant-owned rows carry a non-null `institution_id`, including accounts, transactions, API credentials, webhooks, and customer records where ownership is institutional. Enforce tenant scope in application authorization and consider PostgreSQL row-level security as defense in depth. Set tenant context transaction-locally; never rely on a pooled connection retaining session state. Internal service access is explicit and audited.

Unique keys involving tenant resources include the tenant identifier, such as `(institution_id, idempotency_key)` and `(institution_id, external_customer_ref)`. Global registries (currency, asset, network) are not tenant-owned; tenant eligibility/configuration is represented separately.

## Initial entity groups

- Identity: `users`, `sessions`, `roles`, `permissions`, `user_institutions`.
- Institutions: `institutions`, `institution_environments`, `api_credentials` (hash/metadata only), `institution_limits`.
- Customers: `customers`, `verification_cases`, `risk_profiles`, `beneficiaries`.
- Financial: `accounts`, `account_holds`, `journal_transactions`, `ledger_entries`, `fees`.
- Orchestration: `financial_transactions`, `transaction_transitions`, `idempotency_records`, `quotes`, `provider_attempts`.
- Integrations: `provider_integrations` (adapter metadata and secret references only), `webhook_endpoints`, `webhook_deliveries`.
- Internal access: `system_admin_grants` with separate scopes and revocation state.
- Reliability: `outbox_events`, `reconciliation_runs`, `reconciliation_items`, `audit_logs`.
- Reference data: `currencies`, `assets`, `networks`, `jurisdiction_rules`.

## Ledger rules

An account has an owner, asset/currency, account type, and status. A journal transaction groups entries for one asset/currency and business event. Each entry records account, direction or signed amount, exact amount, transaction reference, and creation time. Require the sum of entries to equal zero for each journal transaction and asset; enforce through a posting procedure or application transaction plus database constraints/verification. Only a controlled posting path can create posted entries. Corrections are new linked journal transactions.

Maintain pending holds separately from settled ledger value. Derive available balance from posted balance less active holds (or maintain a carefully reconciled projection); do not treat a mutable balance cache as the accounting record. Lock affected account rows in a stable order during posting to avoid races and deadlocks.

The current migrations define tenant- and environment-scoped accounts, journals, entries, and holds. Posted journals must contain at least two entries and balance by direction; a database trigger makes posted entries and headers immutable. The application `LedgerService` validates sums with `bigint`, locks account rows in stable order, and posts the journal within one SQL transaction. Accounts carry an explicit normal balance. The account API reports posted balance and available balance (normal balance less active holds); posting checks that projected balances do not consume active holds. A journal may atomically capture one exact matching hold, and posted journals can be reversed through a linked counter-entry journal.

The account API currently provisions institution-owned operational accounts (`SETTLEMENT`, `FEE`, `SUSPENSE`) and reports debit/credit totals, posted balance, available balance, and active holds. It does not yet associate `CUSTOMER` accounts with verified customer records; that requires the customer ownership module.

## Transactions and idempotency

Persist the client idempotency key, institution, request hash, response reference, and lifecycle state. Reuse with an identical request returns the original result; reuse with a different request is rejected. Enforce uniqueness at the database level. Provider attempts have their own idempotency/reference fields and are not conflated with the platform transaction ID.

The transaction API follows this rule and persists its transition history and outbox record atomically. An identical create replay returns the transaction's current state. Ledger journal references are idempotent only when the stored request fingerprint matches; a reused reference with different entries is rejected. Sandbox and production environment IDs are included in transaction, account, journal, hold, and idempotency scopes; composite foreign keys prevent financial records from crossing environments.

## Retention and audit

Audit and ledger records are append-only by application policy and database permissions. Store actor, action, target, timestamp, request correlation ID, and a minimized before/after representation where appropriate. Define retention and deletion rules for personal and compliance data before production launch.

The human identity schema includes expiring institution invitations, user sessions, and one-time refresh-token records. Passwords use scrypt hashes; raw refresh and invitation tokens are never stored. Refresh token history is retained for reuse detection and should be included in the eventual retention policy.

Provider attempts retain idempotency keys, request fingerprints, normalized status, and provider references. Reconciliation batches record provider observations as append-only rows, compare them against expected provider attempt values, and classify each row as matched, variance, unmatched, or pending. Reconciliation currently runs as an internal service; it is not connected to a live provider statement feed.

Migrations 025–026 add durable transfer workflows, tenant/environment-scoped steps, attempt intent and immutable outcome evidence, and append-only workflow events. Each step stores its own timeout, attempt ceiling, retry policy snapshot, stable idempotency key, lease, and reconciliation state. Expired leases with a persisted submission are converted to `UNKNOWN`; automatic resubmission is blocked until a provider outcome is resolved. The service currently provides workflow primitives and a sandbox-only execution guard; the existing provider execution service is not yet driven by these workflow steps. The source-of-funds evidence proposal therefore uses migration 027 when approved for implementation.

Migration 017 adds separately scoped internal administrator grants and the provider integration registry. Provider credentials are never stored in the registry; it records managed secret references and public configuration metadata. `CONFIGURED` does not mean the provider is ready for execution.
