export const SESSION_DELEGATION_TARGET_SCHEMA_STATEMENTS = [
  `
  CREATE TABLE delegation_claim_revisions (
    delegation_id TEXT NOT NULL REFERENCES delegation_contracts(id) ON DELETE CASCADE,
    revision INTEGER NOT NULL CHECK (revision > 0),
    actor_session_id TEXT NOT NULL REFERENCES sessions(id),
    authored_by TEXT NOT NULL,
    reason TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (delegation_id, revision)
  )
  `,
  `
  CREATE TABLE delegation_scope_claims (
    delegation_id TEXT NOT NULL,
    revision INTEGER NOT NULL,
    ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
    access TEXT NOT NULL CHECK (access IN ('read', 'write')),
    target_kind TEXT NOT NULL CHECK (
      target_kind IN ('workspace-file', 'workspace-tree', 'named-resource')
    ),
    target_value TEXT NOT NULL,
    target_namespace TEXT,
    target_scope TEXT CHECK (target_scope IN ('project', 'repository')),
    created_at INTEGER NOT NULL,
    PRIMARY KEY (delegation_id, revision, ordinal),
    FOREIGN KEY (delegation_id, revision)
      REFERENCES delegation_claim_revisions(delegation_id, revision) ON DELETE CASCADE
  )
  `,
  `
  CREATE INDEX idx_delegation_scope_claims_target
  ON delegation_scope_claims (access, target_kind, target_namespace, target_value)
  `,
  `
  CREATE TABLE delegation_undeclared_writes (
    id TEXT PRIMARY KEY,
    delegation_id TEXT NOT NULL REFERENCES delegation_contracts(id) ON DELETE CASCADE,
    worker_session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    run_id TEXT NOT NULL,
    path TEXT NOT NULL,
    claim_revision INTEGER,
    provenance TEXT NOT NULL CHECK (provenance IN ('isolated-turn-checkpoint')),
    created_at INTEGER NOT NULL,
    UNIQUE (delegation_id, run_id, path),
    FOREIGN KEY (delegation_id, claim_revision)
      REFERENCES delegation_claim_revisions(delegation_id, revision)
  )
  `,
  `
  CREATE INDEX idx_delegation_undeclared_writes_contract
  ON delegation_undeclared_writes (delegation_id, created_at, id)
  `,
  `
  CREATE TABLE delegation_conflicts (
    id TEXT PRIMARY KEY,
    left_delegation_id TEXT NOT NULL REFERENCES delegation_contracts(id) ON DELETE CASCADE,
    right_delegation_id TEXT NOT NULL REFERENCES delegation_contracts(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('live-overlap', 'merge-overlap')),
    evidence_json TEXT NOT NULL,
    acknowledged_by TEXT,
    acknowledgement_reason TEXT,
    acknowledged_at INTEGER,
    resolved_at INTEGER,
    created_at INTEGER NOT NULL,
    CHECK (left_delegation_id <> right_delegation_id)
  )
  `,
  `
  CREATE INDEX idx_delegation_conflicts_contract
  ON delegation_conflicts (left_delegation_id, right_delegation_id, resolved_at, created_at)
  `,
  `
  CREATE TABLE delegation_conflict_acknowledgements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conflict_id TEXT NOT NULL REFERENCES delegation_conflicts(id) ON DELETE CASCADE,
    actor_session_id TEXT NOT NULL REFERENCES sessions(id),
    authored_by TEXT NOT NULL,
    reason TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )
  `,
  `
  CREATE INDEX idx_delegation_conflict_acknowledgements_conflict
  ON delegation_conflict_acknowledgements (conflict_id, created_at, id)
  `,
  `
  CREATE TABLE delegation_submissions (
    delegation_id TEXT NOT NULL REFERENCES delegation_contracts(id) ON DELETE CASCADE,
    revision INTEGER NOT NULL CHECK (revision > 0),
    specification_revision INTEGER NOT NULL CHECK (specification_revision > 0),
    summary TEXT NOT NULL,
    submitted_by TEXT NOT NULL,
    source_run_id TEXT REFERENCES session_runs(id),
    provenance TEXT NOT NULL CHECK (provenance IN ('agent-submitted', 'host-captured')),
    created_at INTEGER NOT NULL,
    PRIMARY KEY (delegation_id, revision),
    UNIQUE (delegation_id, source_run_id),
    FOREIGN KEY (delegation_id, specification_revision)
      REFERENCES delegation_specifications(delegation_id, revision)
  )
  `,
  `
  CREATE TABLE delegation_evidence (
    delegation_id TEXT NOT NULL,
    submission_revision INTEGER NOT NULL,
    ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
    kind TEXT NOT NULL CHECK (kind IN (
      'observed-command', 'workspace-diff', 'artifact', 'source-reference', 'asserted-note'
    )),
    summary TEXT NOT NULL,
    reference TEXT,
    provenance_json TEXT,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (delegation_id, submission_revision, ordinal),
    FOREIGN KEY (delegation_id, submission_revision)
      REFERENCES delegation_submissions(delegation_id, revision) ON DELETE CASCADE
  )
  `,
  `
  CREATE TABLE delegation_reviews (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    delegation_id TEXT NOT NULL,
    submission_revision INTEGER NOT NULL,
    decision TEXT NOT NULL CHECK (decision IN ('revision_requested', 'accepted')),
    feedback TEXT,
    reviewer_session_id TEXT NOT NULL REFERENCES sessions(id),
    reviewed_by TEXT NOT NULL,
    specification_revision INTEGER NOT NULL CHECK (specification_revision > 0),
    created_at INTEGER NOT NULL,
    FOREIGN KEY (delegation_id, submission_revision)
      REFERENCES delegation_submissions(delegation_id, revision) ON DELETE CASCADE
  )
  `,
  `
  CREATE INDEX idx_delegation_reviews_contract
  ON delegation_reviews (delegation_id, created_at DESC, id DESC)
  `,
  `
  CREATE TABLE delegation_verifications (
    id TEXT PRIMARY KEY,
    delegation_id TEXT NOT NULL,
    submission_revision INTEGER NOT NULL,
    specification_revision INTEGER NOT NULL CHECK (specification_revision > 0),
    verifier_session_id TEXT NOT NULL REFERENCES sessions(id),
    verified_by TEXT NOT NULL,
    outcome TEXT NOT NULL CHECK (outcome IN ('passed', 'failed', 'inconclusive')),
    summary TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (delegation_id, submission_revision)
      REFERENCES delegation_submissions(delegation_id, revision) ON DELETE CASCADE
  )
  `,
  `
  CREATE INDEX idx_delegation_verifications_submission
  ON delegation_verifications (delegation_id, submission_revision, created_at, id)
  `,
  `
  CREATE TABLE delegation_verification_evidence (
    verification_id TEXT NOT NULL REFERENCES delegation_verifications(id) ON DELETE CASCADE,
    ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
    kind TEXT NOT NULL CHECK (kind IN (
      'observed-command', 'workspace-diff', 'artifact', 'source-reference', 'asserted-note'
    )),
    summary TEXT NOT NULL,
    reference TEXT,
    provenance_json TEXT,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (verification_id, ordinal)
  )
  `,
  `
  CREATE TABLE delegation_state_transitions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    delegation_id TEXT NOT NULL REFERENCES delegation_contracts(id) ON DELETE CASCADE,
    from_state TEXT NOT NULL,
    to_state TEXT NOT NULL,
    reason TEXT NOT NULL,
    actor_session_id TEXT NOT NULL REFERENCES sessions(id),
    authored_by TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )
  `,
  `
  CREATE INDEX idx_delegation_state_transitions_contract
  ON delegation_state_transitions (delegation_id, created_at, id)
  `,
  `
  CREATE TABLE delegation_amendment_proposals (
    id TEXT PRIMARY KEY,
    delegation_id TEXT NOT NULL REFERENCES delegation_contracts(id) ON DELETE CASCADE,
    base_specification_revision INTEGER NOT NULL CHECK (base_specification_revision > 0),
    specification_json TEXT NOT NULL,
    reason TEXT NOT NULL,
    actor_session_id TEXT NOT NULL REFERENCES sessions(id),
    proposed_by TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('pending', 'applied')),
    reviewed_by TEXT,
    applied_specification_revision INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )
  `,
  `
  CREATE INDEX idx_delegation_amendment_proposals_contract
  ON delegation_amendment_proposals (delegation_id, status, created_at, id)
  `,
] as const
