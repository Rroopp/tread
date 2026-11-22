CREATE TABLE institutions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  legal_name TEXT NOT NULL CHECK (length(trim(legal_name)) > 0),
  display_name TEXT NOT NULL CHECK (length(trim(display_name)) > 0),
  country_code CHAR(2) NOT NULL CHECK (country_code ~ '^[A-Z]{2}$'),
  status TEXT NOT NULL DEFAULT 'PENDING_REVIEW'
    CHECK (status IN ('PENDING_REVIEW', 'ACTIVE', 'SUSPENDED', 'CLOSED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL,
  email_normalized TEXT GENERATED ALWAYS AS (lower(trim(email))) STORED,
  password_hash TEXT,
  status TEXT NOT NULL DEFAULT 'INVITED'
    CHECK (status IN ('INVITED', 'ACTIVE', 'LOCKED', 'DISABLED')),
  email_verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT users_email_normalized_unique UNIQUE (email_normalized),
  CONSTRAINT users_email_valid CHECK (email ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$')
);

CREATE TABLE institution_memberships (
  institution_id UUID NOT NULL REFERENCES institutions(id),
  user_id UUID NOT NULL REFERENCES users(id),
  role TEXT NOT NULL CHECK (role IN ('OWNER', 'ADMIN', 'OPERATOR', 'VIEWER', 'COMPLIANCE')),
  status TEXT NOT NULL DEFAULT 'INVITED' CHECK (status IN ('INVITED', 'ACTIVE', 'REVOKED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (institution_id, user_id)
);

CREATE INDEX institution_memberships_user_idx ON institution_memberships(user_id, status);

CREATE TABLE institution_environments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id UUID NOT NULL REFERENCES institutions(id),
  environment TEXT NOT NULL CHECK (environment IN ('SANDBOX', 'PRODUCTION')),
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'DISABLED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (institution_id, environment),
  UNIQUE (id, institution_id)
);

CREATE TABLE api_credentials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id UUID NOT NULL,
  environment_id UUID NOT NULL,
  name TEXT NOT NULL,
  key_prefix TEXT NOT NULL,
  secret_hash TEXT NOT NULL,
  scopes TEXT[] NOT NULL DEFAULT '{}',
  created_by UUID REFERENCES users(id),
  expires_at TIMESTAMPTZ,
  last_used_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (environment_id, institution_id)
    REFERENCES institution_environments(id, institution_id),
  UNIQUE (secret_hash)
);

CREATE INDEX api_credentials_active_prefix_idx
  ON api_credentials(key_prefix) WHERE revoked_at IS NULL;

CREATE TABLE currencies (
  code CHAR(3) PRIMARY KEY CHECK (code ~ '^[A-Z]{3}$'),
  name TEXT NOT NULL,
  minor_unit SMALLINT NOT NULL CHECK (minor_unit BETWEEN 0 AND 18),
  enabled BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE assets (
  code TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  asset_type TEXT NOT NULL CHECK (asset_type IN ('FIAT', 'STABLECOIN', 'CRYPTO')),
  precision SMALLINT NOT NULL CHECK (precision BETWEEN 0 AND 30),
  enabled BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id UUID NOT NULL,
  environment_id UUID NOT NULL,
  account_ref TEXT NOT NULL,
  asset_code TEXT NOT NULL REFERENCES assets(code),
  account_type TEXT NOT NULL CHECK (account_type IN ('CUSTOMER', 'SETTLEMENT', 'FEE', 'SUSPENSE')),
  status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'FROZEN', 'CLOSED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (environment_id, institution_id)
    REFERENCES institution_environments(id, institution_id),
  UNIQUE (institution_id, environment_id, account_ref),
  UNIQUE (id, institution_id),
  UNIQUE (id, institution_id, asset_code)
);

CREATE INDEX accounts_tenant_asset_idx ON accounts(institution_id, asset_code, status);

CREATE TABLE financial_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id UUID NOT NULL,
  environment_id UUID NOT NULL,
  asset_code TEXT NOT NULL REFERENCES assets(code),
  status TEXT NOT NULL DEFAULT 'CREATED' CHECK (status IN (
    'CREATED', 'QUOTED', 'AWAITING_FUNDING', 'FUNDED', 'COMPLIANCE_PENDING',
    'APPROVED', 'EXECUTING', 'BROADCAST', 'CONFIRMING', 'SETTLED',
    'RECONCILED', 'FAILED', 'CANCELLED', 'REQUIRES_REVIEW'
  )),
  client_reference TEXT,
  amount_minor NUMERIC(38, 0) CHECK (amount_minor IS NULL OR amount_minor > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (environment_id, institution_id)
    REFERENCES institution_environments(id, institution_id),
  UNIQUE (id, institution_id),
  UNIQUE (id, institution_id, asset_code)
);

CREATE INDEX financial_transactions_tenant_recent_idx
  ON financial_transactions(institution_id, created_at DESC);
CREATE INDEX financial_transactions_status_idx
  ON financial_transactions(institution_id, status, created_at DESC);

CREATE TABLE transaction_transitions (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  transaction_id UUID NOT NULL,
  institution_id UUID NOT NULL,
  from_status TEXT,
  to_status TEXT NOT NULL,
  reason_code TEXT,
  actor_user_id UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (transaction_id, institution_id)
    REFERENCES financial_transactions(id, institution_id)
);

CREATE INDEX transaction_transitions_timeline_idx
  ON transaction_transitions(institution_id, transaction_id, created_at);

CREATE TABLE idempotency_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id UUID NOT NULL REFERENCES institutions(id),
  environment_id UUID NOT NULL,
  key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'IN_PROGRESS'
    CHECK (status IN ('IN_PROGRESS', 'COMPLETED', 'FAILED')),
  response_status SMALLINT,
  response_body JSONB,
  resource_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ,
  FOREIGN KEY (environment_id, institution_id)
    REFERENCES institution_environments(id, institution_id),
  UNIQUE (institution_id, environment_id, key)
);

CREATE TABLE journal_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id UUID NOT NULL,
  asset_code TEXT NOT NULL REFERENCES assets(code),
  financial_transaction_id UUID,
  reference_type TEXT NOT NULL,
  reference_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'POSTED', 'VOID')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  posted_at TIMESTAMPTZ,
  FOREIGN KEY (financial_transaction_id, institution_id, asset_code)
    REFERENCES financial_transactions(id, institution_id, asset_code),
  UNIQUE (id, institution_id, asset_code),
  UNIQUE (institution_id, reference_type, reference_id, asset_code)
);

CREATE TABLE ledger_entries (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  journal_transaction_id UUID NOT NULL,
  institution_id UUID NOT NULL,
  asset_code TEXT NOT NULL,
  account_id UUID NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('DEBIT', 'CREDIT')),
  amount_minor NUMERIC(38, 0) NOT NULL CHECK (amount_minor > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (journal_transaction_id, institution_id, asset_code)
    REFERENCES journal_transactions(id, institution_id, asset_code),
  FOREIGN KEY (account_id, institution_id, asset_code)
    REFERENCES accounts(id, institution_id, asset_code)
);

CREATE INDEX ledger_entries_account_timeline_idx
  ON ledger_entries(institution_id, account_id, created_at, id);
CREATE INDEX ledger_entries_journal_idx ON ledger_entries(journal_transaction_id);

CREATE FUNCTION enforce_journal_balance() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  debit_total NUMERIC(38, 0);
  credit_total NUMERIC(38, 0);
  entry_count BIGINT;
BEGIN
  IF NEW.status <> 'POSTED' THEN
    RETURN NEW;
  END IF;

  SELECT
    COALESCE(SUM(amount_minor) FILTER (WHERE direction = 'DEBIT'), 0),
    COALESCE(SUM(amount_minor) FILTER (WHERE direction = 'CREDIT'), 0),
    COUNT(*)
  INTO debit_total, credit_total, entry_count
  FROM ledger_entries
  WHERE journal_transaction_id = NEW.id;

  IF entry_count < 2 OR debit_total <> credit_total THEN
    RAISE EXCEPTION 'Posted journal % must have at least two balanced entries', NEW.id
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE CONSTRAINT TRIGGER journal_must_balance
  AFTER INSERT OR UPDATE ON journal_transactions
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION enforce_journal_balance();

CREATE FUNCTION protect_posted_journal() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  journal_status TEXT;
BEGIN
  SELECT status INTO journal_status
  FROM journal_transactions
  WHERE id = COALESCE(NEW.journal_transaction_id, OLD.journal_transaction_id);

  IF journal_status = 'POSTED' THEN
    RAISE EXCEPTION 'Entries in a posted journal are immutable'
      USING ERRCODE = '23514';
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER ledger_entries_are_immutable
  BEFORE INSERT OR UPDATE OR DELETE ON ledger_entries
  FOR EACH ROW EXECUTE FUNCTION protect_posted_journal();

CREATE FUNCTION protect_posted_journal_header() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status <> 'DRAFT' THEN
    RAISE EXCEPTION 'Only draft journal headers may be changed'
      USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  IF NEW.status = 'POSTED' AND NEW.posted_at IS NULL THEN
    NEW.posted_at := now();
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER journal_header_transition_guard
  BEFORE UPDATE OR DELETE ON journal_transactions
  FOR EACH ROW EXECUTE FUNCTION protect_posted_journal_header();

CREATE TABLE account_holds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id UUID NOT NULL,
  account_id UUID NOT NULL,
  asset_code TEXT NOT NULL,
  transaction_id UUID,
  amount_minor NUMERIC(38, 0) NOT NULL CHECK (amount_minor > 0),
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'RELEASED', 'CAPTURED')),
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (account_id, institution_id, asset_code)
    REFERENCES accounts(id, institution_id, asset_code),
  FOREIGN KEY (transaction_id, institution_id, asset_code)
    REFERENCES financial_transactions(id, institution_id, asset_code)
);

CREATE INDEX account_holds_active_idx ON account_holds(institution_id, account_id)
  WHERE status = 'ACTIVE';

CREATE TABLE outbox_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id UUID REFERENCES institutions(id),
  aggregate_type TEXT NOT NULL,
  aggregate_id UUID NOT NULL,
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  published_at TIMESTAMPTZ,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  last_error TEXT
);

CREATE INDEX outbox_events_pending_idx ON outbox_events(occurred_at)
  WHERE published_at IS NULL;

CREATE TABLE audit_logs (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  institution_id UUID REFERENCES institutions(id),
  actor_user_id UUID REFERENCES users(id),
  action TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT,
  request_id TEXT,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX audit_logs_tenant_timeline_idx
  ON audit_logs(institution_id, created_at DESC);

CREATE FUNCTION reject_audit_log_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Audit log records are append-only'
    USING ERRCODE = '23514';
END;
$$;

CREATE TRIGGER audit_logs_are_append_only
  BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION reject_audit_log_mutation();

INSERT INTO currencies (code, name, minor_unit, enabled) VALUES
  ('KES', 'Kenyan Shilling', 2, true),
  ('USD', 'United States Dollar', 2, true),
  ('AED', 'United Arab Emirates Dirham', 2, false)
ON CONFLICT (code) DO NOTHING;

INSERT INTO assets (code, name, asset_type, precision, enabled) VALUES
  ('KES', 'Kenyan Shilling', 'FIAT', 2, true),
  ('USD', 'United States Dollar', 'FIAT', 2, true),
  ('AED', 'United Arab Emirates Dirham', 'FIAT', 2, false),
  ('USDC', 'USD Coin', 'STABLECOIN', 6, false),
  ('USDT', 'Tether USD', 'STABLECOIN', 6, false),
  ('BTC', 'Bitcoin', 'CRYPTO', 8, false),
  ('ETH', 'Ether', 'CRYPTO', 18, false)
ON CONFLICT (code) DO NOTHING;
