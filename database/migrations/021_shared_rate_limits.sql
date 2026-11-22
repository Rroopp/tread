CREATE TABLE api_rate_limits (
  throttler_name TEXT NOT NULL,
  tracker_key TEXT NOT NULL,
  window_started_at TIMESTAMPTZ NOT NULL,
  total_hits INTEGER NOT NULL CHECK (total_hits >= 0),
  blocked_until TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (throttler_name, tracker_key)
);

CREATE INDEX api_rate_limits_expiry_idx ON api_rate_limits(expires_at);
