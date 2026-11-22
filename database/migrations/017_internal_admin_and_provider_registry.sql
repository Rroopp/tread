CREATE TABLE system_admin_grants (
  user_id UUID PRIMARY KEY REFERENCES users(id),
  scopes TEXT[] NOT NULL CHECK (cardinality(scopes) > 0),
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'DISABLED')),
  granted_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE provider_integrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_code TEXT NOT NULL UNIQUE CHECK (provider_code ~ '^[a-z][a-z0-9_]{1,63}$'),
  display_name TEXT NOT NULL,
  capability TEXT NOT NULL CHECK (capability IN ('BANK_RAIL', 'FX_LIQUIDITY', 'CUSTODY', 'BLOCKCHAIN', 'KYC_KYB', 'AML_SANCTIONS', 'TRAVEL_RULE')),
  environment TEXT NOT NULL CHECK (environment IN ('SANDBOX', 'PRODUCTION')),
  status TEXT NOT NULL DEFAULT 'DISABLED' CHECK (status IN ('DISABLED', 'CONFIGURED', 'SANDBOX_READY', 'LIVE_READY', 'DEGRADED')),
  adapter_key TEXT NOT NULL,
  secret_reference TEXT,
  public_config JSONB NOT NULL DEFAULT '{}',
  last_health_check_at TIMESTAMPTZ,
  last_health_status TEXT CHECK (last_health_status IS NULL OR last_health_status IN ('HEALTHY', 'DEGRADED', 'UNAVAILABLE')),
  created_by UUID REFERENCES users(id),
  updated_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (secret_reference IS NULL OR secret_reference !~* '(password|secret|token|key)=' )
);

CREATE INDEX provider_integrations_capability_idx
  ON provider_integrations(capability, environment, status);
