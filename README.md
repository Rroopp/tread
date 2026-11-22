# Global Financial Infrastructure Platform

**TREAD — Evidence-led off-ramp coordination for fintechs and payment companies.**

TREAD is an API-first, multi-tenant workflow and evidence platform focused on a KES ↔ USDC off-ramp through one licensed third-party provider. TREAD coordinates records and provider hand-offs; it does not custody customer assets. The current corridor is sandbox-only: no live provider is connected and no funds move. Real-estate/property tokenization is out of scope.

## Initial technical direction

- **Primary API:** TypeScript, Node.js LTS, NestJS modular monolith.
- **Supporting services:** Python only for bounded workloads where its ecosystem is useful; the NestJS API remains the source of business rules and transaction orchestration.
- **Database:** PostgreSQL with exact `NUMERIC` amounts, transactional ledger posting, migrations, and tenant isolation.
- **Frontend (planned):** React, Next.js, TypeScript, Tailwind CSS.
- **Future clients:** A mobile app can use the same versioned REST API; keep business rules and authorization in the backend rather than a web client.
- **Cache and jobs (planned):** Redis plus durable background processing and an outbox. Redis is never the financial source of truth.

The supplied master brief specified MySQL, while the initial project direction specified PostgreSQL. This repository follows PostgreSQL; revisit only if a deployment or partner constraint requires MySQL.

## Build status

The repository has a NestJS API foundation with PostgreSQL, institution and environment scoped API keys, onboarding and human sessions, an institution dashboard, account and ledger operations, idempotent quotes and transaction requests, database-enforced compliance gates, sandbox compliance simulation, signed webhook delivery, reconciliation matching, typed provider contracts, and a restricted internal operations console. API credentials, sandbox webhooks, and developer guidance are available in the Next.js dashboard. The platform does not yet execute financial transfers: live bank, FX, custody, blockchain, sanctions/KYC adapters and provider-backed transaction workflows are not integrated.

## Run locally

Requirements: Node.js 22+, npm, and Docker Compose.

```sh
npm install
cp .env.example .env
docker compose up --build -d
```

Compose starts PostgreSQL, applies migrations, and runs the API and dashboard in the background. The API listens on `http://localhost:3000`; the dashboard is at `http://localhost:3001`. API and dashboard containers use `restart: unless-stopped` and health checks, so they restart after a Docker daemon or machine restart as long as Docker is enabled at boot. Run `docker compose down` to stop them; it preserves the database volume. These Compose credentials and encryption keys are development-only and must never be used in production.

The API root provides status, `/favicon.ico` returns 204, liveness/readiness are at `/v1/health/live` and `/v1/health/ready`, and OpenAPI is at `/docs` outside production mode. Responses include a generated `X-Request-Id`, also used in the standard error envelope. Run `docker compose exec api node dist/database/seed-dev.js` to seed a local active sandbox institution and print a one-time sandbox API key. The local database credentials and seeded institution are for development only.

Run `docker compose exec api node dist/database/seed-dev-user.js` after migrations to create a local institution owner login. It prints the institution ID, email, and one-time generated password. This command is disabled in production; use the credentials only with the local sandbox.

The authenticated sandbox API supports transaction request records, institution-owned operational accounts, configured simulated quotes, and balance-backed account holds. Transaction creation is idempotent and writes a `transaction.created` outbox event; account creation is idempotent by account reference and writes audit/outbox records. Account reads expose posted balance, available balance, debit/credit totals, and active holds. Live quoting, provider execution, and settlement are not available. Keep the sandbox key out of source control and shell history.

Sandbox quotes can be created using `POST /v1/quotes`. Set `SANDBOX_RATES_JSON` to an explicit JSON mapping such as `{"KES:USD":{"numerator":"1","denominator":"1"}}`; the ratio maps source minor units to destination minor units. These configured rates are simulated and carry `quoteMode: SANDBOX_SIMULATED`. Quote creation in production is disabled until a live liquidity provider is integrated. A sandbox quote can be consumed once by passing its `quoteId` to `POST /v1/transactions`; this creates a `QUOTED` request record and does not execute or settle funds.

Institution onboarding starts at `POST /v1/onboarding/institutions`. Applications remain pending until reviewed and approved by one internal administrator, then confirmed by a different administrator. Invitations use a durable outbox and provider-neutral email interface. Local development uses a console sender; production delivery fails closed until configured. Owner/admin users sign in with TOTP MFA.

The pilot dashboard is a thin operator workspace for transactions, accounts, compliance review, API credentials, and sandbox webhooks. Its sidebar defers standalone reports, usage, team, customer/beneficiary and interactive developer-console surfaces. Supporting APIs and records remain in this build, but usage counts are not billing-grade and customer records do not establish verification. Integrators should use the versioned API and generated OpenAPI reference. Account creation does not fund an account.

Internal operators receive separate platform scopes using `npm run admin:grant -- <verified-user-email> <comma-separated-scopes>` and can be disabled with `npm run admin:revoke -- <user-email>`. These commands require a privileged database connection. The operations console is at `/dashboard/admin`; provider secrets are stored in a managed secret system and only references are recorded in PostgreSQL. `CONFIGURED` does not mean executable or live-ready.

## Verification

Financial integration tests write persistent accounting and audit records. Run them only against a disposable PostgreSQL database whose name contains `test`:

```sh
export TEST_DATABASE_URL=postgresql://tread:tread_dev_password@localhost:5432/tread_test
DATABASE_URL="$TEST_DATABASE_URL" npm run db:migrate
npm run test:state-machine
npm run test:ledger-integration
npm run test:compliance-integration
npm run test:reconciliation-integration
```

Webhook delivery requires an exact hostname in `WEBHOOK_ALLOWED_HOSTS` and a base64 encoded 32-byte `WEBHOOK_SECRET_ENCRYPTION_KEY`. Generate and store that key through managed secrets in deployed environments. Live provider integrations are not configured.

## Dashboard preview

The Next.js landing page and institutional dashboard source are in `apps/dashboard`. The public landing page is at `/`; the pilot workspace provides overview, transactions, accounts, compliance, API credentials, sandbox webhooks, and restricted platform operations. OpenAPI is served at `/docs` outside production mode. The static preview is separate and does not represent the live dashboard.

## Project documents

- [Application guide](APPLICATION_GUIDE.md): detailed product, workflow, security, and operating guide
- [Architecture](ARCHITECTURE.md)
- [Database design](DATABASE.md)
- [Security requirements](SECURITY.md)
- [API conventions](API.md)
- [Development roadmap](DEVELOPMENT_ROADMAP.md)
- [Changelog](CHANGELOG.md)
- [Security and tenant-isolation audit](docs/AUDIT.md)
- [Provider onboarding requirements](docs/PROVIDER_ONBOARDING.md)
- [Source-of-funds schema plan](docs/EVIDENCE_PACKAGE_SCHEMA_PLAN.md) (design only)

## Brand palette

Use the refined TREAD palette with a clear hierarchy: **Cloud White `#F7F9F6`** is the primary canvas (about 65%); **Ink Charcoal `#17191B`** carries text and dark surfaces (about 20%); **Electric Lime `#C5FF36`** marks primary actions and selected states (about 11%); **Hot Pink `#FF3E96`** is reserved for selective brand moments (about 4%). Use dark text on lime and charcoal text on pink; use semantic green, amber, and red for transaction outcomes. Keep surfaces flat, minimize cards, and avoid decorative gradients. Use light Inter headlines and Geist Mono for compact technical labels.
