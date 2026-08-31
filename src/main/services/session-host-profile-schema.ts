export const SESSION_PROFILE_TARGET_SCHEMA_STATEMENTS = [
  `
  CREATE TABLE session_client_profiles (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    credential_verifier TEXT NOT NULL,
    capabilities_json TEXT NOT NULL,
    scope_json TEXT NOT NULL,
    authorization_ceiling TEXT NOT NULL CHECK (
      authorization_ceiling IN ('yolo', 'ask-for-approval')
    ),
    management_envelope_json TEXT,
    revoked_at INTEGER,
    last_authenticated_at INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )
  `,
  `
  CREATE INDEX idx_session_client_profiles_active_name
  ON session_client_profiles (name, revoked_at)
  `,
  `
  CREATE TABLE session_client_profile_audit (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    profile_id TEXT NOT NULL REFERENCES session_client_profiles(id),
    action TEXT NOT NULL CHECK (action IN (
      'created', 'updated', 'rotated', 'revoked', 'authenticated', 'authentication_failed'
    )),
    actor_caller_id TEXT NOT NULL,
    detail_json TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )
  `,
  `
  CREATE INDEX idx_session_client_profile_audit_profile
  ON session_client_profile_audit (profile_id, created_at DESC, id DESC)
  `,
] as const
