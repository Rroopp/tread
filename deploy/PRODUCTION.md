# Production deployment and operations

This repository provides container build definitions and a production Compose topology for the API and dashboard. PostgreSQL is intentionally external and must be a managed, supported PostgreSQL service with TLS, automated backups, point-in-time recovery, and tested restores. Compose does not publish the API port. The dashboard binds to loopback for a host reverse proxy; terminate TLS at a maintained proxy/load balancer and forward only to `127.0.0.1:3001`.

## Release procedure

1. Use CI green on the exact commit. Build versioned images and scan dependencies/images in the deployment pipeline.
2. Create a database backup/restore point and confirm the restore path before schema changes.
3. Provision production secrets through the deployment secret manager: `DATABASE_URL`, `AUTH_ACCESS_TOKEN_SECRET`, `WEBHOOK_SECRET_ENCRYPTION_KEY`, `DATA_ENCRYPTION_KEYS_JSON`, `DATA_ENCRYPTION_CURRENT_KEY_ID`, `WEBHOOK_ALLOWED_HOSTS`, `CORS_ORIGINS`, and the dashboard’s `TREAD_PUBLIC_API_URL`. Use a unique random 32-byte key per keyring entry. Keep previous key IDs available during rotation until records have been re-encrypted. Never commit production env files.
4. Deploy the API image and run `node dist/database/migrate.js` as a one-off release task using the same database configuration. Migrations are forward-only; recover by rolling the application image back only when the migration is backward-compatible, otherwise apply a reviewed forward fix.
5. Deploy the dashboard image, confirm API and dashboard health checks, test login, inspect logs/metrics, and verify alerts before sending traffic.
6. Keep production financial execution disabled until provider sandbox validation, production credentials, licenses, compliance policy, reconciliation ingestion, and incident procedures have been reviewed and authorized.

Example topology check (use non-production placeholder values only):

```sh
TREAD_RELEASE_TAG=smoke DATABASE_URL=postgresql://user:password@db.example:5432/tread AUTH_ACCESS_TOKEN_SECRET=replace-with-a-long-random-secret WEBHOOK_ALLOWED_HOSTS=hooks.example.com WEBHOOK_SECRET_ENCRYPTION_KEY=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA= CORS_ORIGINS=https://dashboard.example.com TREAD_PUBLIC_API_URL=https://api.example.com docker compose -f deploy/compose.production.yml config --quiet
```

Images can be built with `docker build -f Dockerfile.api -t tread-api:<release> .` and `docker build -f Dockerfile.dashboard -t tread-dashboard:<release> .`. `TREAD_RELEASE_TAG` identifies the paired release images in Compose.

## Required operational controls

- Store database, JWT, webhook, and provider credentials in managed secret storage with access logging and rotation. Provider registry records contain secret references only.
- Customer profiles and beneficiary destinations use AES-256-GCM encryption with versioned key IDs. Production must supply the keyring through managed secret storage; the deterministic key used in local/test mode is unsuitable for any deployed environment. Only masked beneficiary destinations are returned to institution dashboards.
- Configure PostgreSQL TLS, private networking, least-privilege application credentials, PITR, encryption at rest, and alerting for storage, connections, replication, and backup failures.
- The API applies in-process request limits (30 requests/minute per bearer credential, or per client IP for unauthenticated requests, with tighter login/onboarding limits). This counter is per process and is not shared across replicas; enforce equivalent limits at the API gateway or configure a shared throttler store before scaling horizontally.
- If the API sits behind a reverse proxy, set `TRUSTED_PROXY_CIDRS` to the exact proxy address ranges so Express uses forwarded client IPs only from trusted hops. Do not trust arbitrary `X-Forwarded-For` values.
- Webhook targets require HTTPS and exact hostname allowlisting. Delivery resolves and pins a public IPv4 address per attempt, rejects private/reserved addresses, verifies TLS against the allowlisted hostname, rejects redirects, and enforces an eight-second deadline. Keep outbound network egress restricted to approved destinations as an additional deployment control.
- Send JSON application logs to centralized storage, retain `X-Request-Id`, instrument API and worker spans/metrics with OpenTelemetry, and alert on readiness, error rates, p95 latency, queue age, webhook retries, compliance backlog, provider `UNKNOWN` attempts, and reconciliation variances.
- Define service owners, on-call coverage, incident severity, customer/regulator notification paths, RPO/RTO, and tested recovery steps before production financial traffic.
- Disable a provider integration immediately when its health, credentials, settlement, or reconciliation state is uncertain. Preserve attempts and evidence; do not retry non-idempotent external requests without checking provider status.
- Perform daily reconciliation and exception review for each live provider. A successful API response is not settlement evidence.
- Restrict internal platform access using `system_admin_grants`, least-privilege scopes, MFA at the identity layer, audited database access, and prompt grant revocation. The current application does not implement MFA.
- Run database restore drills and review dependency/security updates on a scheduled basis. Do not expose PostgreSQL or the API directly to the public internet.

## Current readiness boundary

The Compose file is a deployment baseline, not a completed production environment. No cloud account, image registry, DNS/TLS endpoint, managed PostgreSQL instance, alerting destination, KMS, live provider, or partner credential is configured here. The dashboard currently has no MFA or production identity-provider integration. No live financial execution should be enabled until these are provisioned and verified.
