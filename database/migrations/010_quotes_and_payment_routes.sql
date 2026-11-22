CREATE TABLE quotes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id UUID NOT NULL,
  environment_id UUID NOT NULL,
  source_asset_code TEXT NOT NULL REFERENCES assets(code),
  destination_asset_code TEXT NOT NULL REFERENCES assets(code),
  source_amount_minor NUMERIC(38, 0) NOT NULL CHECK (source_amount_minor > 0),
  destination_amount_minor NUMERIC(38, 0) NOT NULL CHECK (destination_amount_minor > 0),
  rate_numerator NUMERIC(38, 0) NOT NULL CHECK (rate_numerator > 0),
  rate_denominator NUMERIC(38, 0) NOT NULL CHECK (rate_denominator > 0),
  fee_amount_minor NUMERIC(38, 0) NOT NULL DEFAULT 0 CHECK (fee_amount_minor >= 0),
  provider_code TEXT NOT NULL,
  quote_mode TEXT NOT NULL CHECK (quote_mode IN ('SANDBOX_SIMULATED', 'LIVE')),
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'CONSUMED', 'EXPIRED', 'CANCELLED')),
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (environment_id, institution_id)
    REFERENCES institution_environments(id, institution_id),
  UNIQUE (id, institution_id, environment_id)
);

CREATE INDEX quotes_tenant_recent_idx ON quotes(institution_id, environment_id, created_at DESC);
CREATE INDEX quotes_expiry_idx ON quotes(expires_at) WHERE status = 'ACTIVE';

ALTER TABLE financial_transactions
  ADD COLUMN destination_asset_code TEXT REFERENCES assets(code),
  ADD COLUMN destination_amount_minor NUMERIC(38, 0)
    CHECK (destination_amount_minor IS NULL OR destination_amount_minor > 0),
  ADD COLUMN quote_id UUID,
  ADD CONSTRAINT financial_transactions_quote_fk
    FOREIGN KEY (quote_id, institution_id, environment_id)
    REFERENCES quotes(id, institution_id, environment_id);
