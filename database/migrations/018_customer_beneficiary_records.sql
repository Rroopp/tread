CREATE TABLE institution_customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id UUID NOT NULL REFERENCES institutions(id),
  environment_id UUID NOT NULL REFERENCES institution_environments(id),
  external_reference TEXT NOT NULL CHECK (length(external_reference) BETWEEN 2 AND 120),
  customer_type TEXT NOT NULL CHECK (customer_type IN ('INDIVIDUAL', 'BUSINESS')),
  country_code CHAR(2) NOT NULL CHECK (country_code ~ '^[A-Z]{2}$'),
  status TEXT NOT NULL DEFAULT 'PENDING_VERIFICATION'
    CHECK (status IN ('PENDING_VERIFICATION', 'VERIFIED', 'REJECTED', 'DISABLED')),
  pii_key_id TEXT NOT NULL,
  pii_ciphertext TEXT NOT NULL,
  pii_iv TEXT NOT NULL,
  pii_auth_tag TEXT NOT NULL,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (institution_id, environment_id, external_reference),
  UNIQUE (id, institution_id, environment_id),
  FOREIGN KEY (environment_id, institution_id)
    REFERENCES institution_environments(id, institution_id)
);

CREATE INDEX institution_customers_status_idx
  ON institution_customers(institution_id, environment_id, status, created_at DESC);

CREATE TABLE institution_beneficiaries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id UUID NOT NULL REFERENCES institutions(id),
  environment_id UUID NOT NULL REFERENCES institution_environments(id),
  customer_id UUID,
  external_reference TEXT NOT NULL CHECK (length(external_reference) BETWEEN 2 AND 120),
  destination_type TEXT NOT NULL CHECK (destination_type IN ('BANK', 'MOBILE_MONEY', 'CRYPTO_WALLET')),
  country_code CHAR(2) NOT NULL CHECK (country_code ~ '^[A-Z]{2}$'),
  currency_code TEXT NOT NULL CHECK (currency_code ~ '^[A-Z0-9]{2,12}$'),
  status TEXT NOT NULL DEFAULT 'PENDING_VERIFICATION'
    CHECK (status IN ('PENDING_VERIFICATION', 'VERIFIED', 'DISABLED')),
  details_key_id TEXT NOT NULL,
  details_ciphertext TEXT NOT NULL,
  details_iv TEXT NOT NULL,
  details_auth_tag TEXT NOT NULL,
  masked_destination TEXT NOT NULL CHECK (length(masked_destination) BETWEEN 2 AND 48),
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (institution_id, environment_id, external_reference),
  FOREIGN KEY (environment_id, institution_id)
    REFERENCES institution_environments(id, institution_id),
  FOREIGN KEY (customer_id, institution_id, environment_id)
    REFERENCES institution_customers(id, institution_id, environment_id)
);

CREATE INDEX institution_beneficiaries_status_idx
  ON institution_beneficiaries(institution_id, environment_id, status, created_at DESC);

CREATE TABLE customer_verification_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL,
  institution_id UUID NOT NULL,
  environment_id UUID NOT NULL,
  provider_code TEXT NOT NULL,
  decision TEXT NOT NULL CHECK (decision IN ('PENDING', 'VERIFIED', 'REJECTED', 'REVIEW')),
  reason_code TEXT,
  provider_reference TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (customer_id, institution_id, environment_id)
    REFERENCES institution_customers(id, institution_id, environment_id)
);

CREATE INDEX customer_verification_events_customer_idx
  ON customer_verification_events(customer_id, created_at DESC);

CREATE FUNCTION prevent_verification_event_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Customer verification events are append-only'
    USING ERRCODE = '23514';
END;
$$;

CREATE TRIGGER customer_verification_events_are_append_only
  BEFORE UPDATE OR DELETE ON customer_verification_events
  FOR EACH ROW EXECUTE FUNCTION prevent_verification_event_mutation();
