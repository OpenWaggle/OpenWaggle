/**
 * What kind of failure a Session Host refusal is, and so which exit code an `openwaggle` CLI
 * returns for it (ADR 0063). The Session Host assigns the kind; clients copy it and never read
 * it from the code's wording. The list is covered from 1.0: a kind may be added, never removed.
 */
export const SESSION_HOST_ERROR_KINDS = [
  'usage',
  'authentication',
  'authorization',
  'not_found',
  'conflict',
  'timeout',
  'host_unavailable',
  'resync_required',
  'internal',
] as const

export type SessionHostErrorKind = (typeof SESSION_HOST_ERROR_KINDS)[number]

export function isSessionHostErrorKind(value: unknown): value is SessionHostErrorKind {
  return SESSION_HOST_ERROR_KINDS.some((kind) => kind === value)
}

/**
 * Every code a Session Host refusal can carry, with its kind. A refusal is built only through
 * `sessionHostRefusal`, which takes a key of this table, so a new code cannot ship without a kind.
 * Within one major version a code keeps its kind (`session-host-refusals.unit.test.ts` pins them).
 */
export const SESSION_HOST_REFUSAL_KINDS = {
  // Not found: the target does not exist.
  session_not_found: 'not_found',
  delegation_not_found: 'not_found',
  export_not_found: 'not_found',
  branch_not_found: 'not_found',
  follow_up_not_found: 'not_found',
  target_not_found: 'not_found',
  lineage_target_missing: 'not_found',
  session_profile_not_found: 'not_found',
  task_not_found: 'not_found',
  // An `access profiles` command names a profile that does not exist.
  target_profile_not_found: 'not_found',
  'interaction-not-found': 'not_found',
  source_not_found: 'not_found',
  delegation_conflict_not_found: 'not_found',
  submission_not_found: 'not_found',
  delegation_amendment_proposal_not_found: 'not_found',
  delegation_dependency_not_found: 'not_found',

  // Authorization: the caller may not do this.
  capability_denied: 'authorization',
  target_scope_denied: 'authorization',
  target_not_authorized: 'authorization',
  authorization_ceiling_exceeded: 'authorization',
  management_envelope_missing: 'authorization',
  management_envelope_exceeded: 'authorization',
  missing_access_profiles: 'authorization',
  cannot_edit_own_policy: 'authorization',
  profile_credential_control_requires_local_user: 'authorization',
  profile_redelegation_requires_local_user: 'authorization',
  source_run_not_authorized: 'authorization',
  // Only the Delegation's parent, or only its Worker, may do this.
  parent_required: 'authorization',
  worker_required: 'authorization',
  // A revision request or reopen sends the Worker its feedback as the reviewer's Follow-up, so a
  // reviewer that may not message that Worker cannot send it back to work (#454).
  worker_message_denied: 'authorization',
  follow_up_adopt_requires_desktop_user: 'authorization',
  follow_up_edit_requires_desktop_user: 'authorization',
  // The caller's own authority changed since it was granted, for example its parent's grant.
  authority_changed: 'authorization',

  // Authentication: a credential is missing, unreadable or refused.
  authentication_failed: 'authentication',
  authentication_throttled: 'authentication',
  credential_rejected: 'authentication',
  credential_required: 'authentication',
  // The caller's own access profile was revoked or no longer exists.
  profile_revoked: 'authentication',
  profile_not_found: 'authentication',

  // Usage: the request itself is malformed.
  invalid_cursor: 'usage',
  invalid_schedule: 'usage',
  invalid_time_zone: 'usage',
  invalid_target: 'usage',
  'invalid-response-payload': 'usage',
  reserved_idempotency_key: 'usage',
  report_empty: 'usage',
  submission_empty: 'usage',
  dependency_reason_required: 'usage',
  amendment_reason_required: 'usage',
  claim_reason_required: 'usage',
  conflict_acknowledgement_reason_required: 'usage',
  transition_reason_required: 'usage',
  verification_summary_required: 'usage',
  claim_target_invalid: 'usage',
  delegation_dependency_invalid: 'usage',
  delegation_specification_invalid: 'usage',

  // Timeout: a time limit ran out.
  handshake_timeout: 'timeout',
  'interaction-timeout': 'timeout',

  // Host unavailable: the Session Host is stopping, stopped, or handing over.
  host_draining: 'host_unavailable',
  host_stopped: 'host_unavailable',
  host_lost: 'host_unavailable',

  // Resync required: the caller's cursor no longer has a place in the event stream.
  resync_required: 'resync_required',

  // Internal: the Session Host failed while doing it, or could not read the request.
  command_failed: 'internal',
  protocol_error: 'internal',
  invalid_frame: 'internal',
  inbound_backpressure_exceeded: 'internal',
  attachment_resolution_failed: 'internal',
  export_failed: 'internal',
  steering_failed: 'internal',
  workspace_snapshot_failed: 'internal',
  workspace_target_transfer_failed: 'internal',

  // Conflict: the current state refuses it.
  follow_up_reserved: 'conflict',
  follow_up_already_exists: 'conflict',
  follow_up_edit_held: 'conflict',
  follow_up_edit_not_held: 'conflict',
  follow_up_edit_hold_mismatch: 'conflict',
  follow_up_not_adoptable: 'conflict',
  follow_up_not_editable: 'conflict',
  queue_already_paused: 'conflict',
  queue_already_running: 'conflict',
  queue_byte_capacity_reached: 'conflict',
  queue_capacity_reached: 'conflict',
  queue_order_mismatch: 'conflict',
  queue_revision_changed: 'conflict',
  run_already_active: 'conflict',
  run_already_stopping: 'conflict',
  run_changed: 'conflict',
  run_not_active: 'conflict',
  run_not_live: 'conflict',
  run_not_starting: 'conflict',
  run_not_steerable: 'conflict',
  run_not_streaming: 'conflict',
  run_authorization_override_requires_idle_session: 'conflict',
  thinking_level_requires_idle_session: 'conflict',
  session_run_active: 'conflict',
  steering_capacity_reached: 'conflict',
  host_run_ceiling_reached: 'conflict',
  host_capacity_reached: 'conflict',
  parent_concurrency_limit_reached: 'conflict',
  parent_capacity_reached: 'conflict',
  parent_run_changed: 'conflict',
  parent_run_not_active: 'conflict',
  hive_wake_not_needed: 'conflict',
  hive_wake_cause_may_not_wake: 'conflict',
  record_too_large: 'conflict',
  semantic_not_ready: 'conflict',
  cursor_expired: 'conflict',
  cursor_mismatch: 'conflict',
  subscription_limit_exceeded: 'conflict',
  target_ambiguous: 'conflict',
  target_is_source: 'conflict',
  targets_empty: 'conflict',
  reply_target_mismatch: 'conflict',
  delegation_conflict_already_acknowledged: 'conflict',
  delegation_conflict_resolved: 'conflict',
  delegation_dependencies_unmet: 'conflict',
  delegation_not_accepted: 'conflict',
  delegation_not_amendable: 'conflict',
  delegation_not_cancellable: 'conflict',
  delegation_not_contributable: 'conflict',
  delegation_not_reviewable: 'conflict',
  delegation_operation_invalid: 'conflict',
  delegation_terminal: 'conflict',
  delegation_workspace_missing: 'conflict',
  specification_revision_stale: 'conflict',
  submission_revision_stale: 'conflict',
  delegation_amendment_proposal_mismatch: 'conflict',
  delegation_amendment_proposal_not_pending: 'conflict',
  delegation_amendment_proposal_stale: 'conflict',
  delegation_dependency_exists: 'conflict',
  session_not_idle: 'conflict',
  workspace_unavailable: 'conflict',
  workspace_base_ref_mismatch: 'conflict',
  pi_session_file_unusable: 'conflict',
  session_worktree_missing: 'conflict',
  profile_name_exists: 'conflict',
  // `access profiles update` or `rotate` names a revoked profile.
  target_profile_revoked: 'conflict',
  profile_admission_changed: 'conflict',
  // Credentials were generated too often: retry later.
  profile_credential_rate_limited: 'conflict',
  'interaction-mismatch': 'conflict',
  'custom-renderer-unavailable': 'conflict',
  kind_change_not_allowed: 'conflict',
  target_session_change_not_allowed: 'conflict',
  creator_identity_unsupported: 'conflict',
  task_limit_reached: 'conflict',
  run_already_in_progress: 'conflict',
  scheduler_unavailable: 'conflict',
  schedule_ended: 'conflict',
  stop_condition_required: 'conflict',
  heartbeat_only: 'conflict',
  wake_check_changed: 'conflict',
  run_not_scheduled: 'conflict',
} as const satisfies Readonly<Record<string, SessionHostErrorKind>>

export type SessionHostRefusalCode = keyof typeof SESSION_HOST_REFUSAL_KINDS

/** The `code` and `kind` of a refusal, for spreading into an outcome or an error. */
export function sessionHostRefusal<const Code extends SessionHostRefusalCode>(code: Code) {
  return { code, kind: SESSION_HOST_REFUSAL_KINDS[code] }
}

export function isSessionHostRefusalCode(value: string): value is SessionHostRefusalCode {
  return Object.hasOwn(SESSION_HOST_REFUSAL_KINDS, value)
}

/**
 * The kind of a code that reached the Session Host's error frame from a thrown failure. A code
 * that is not in the table is an unexpected failure, `internal`.
 */
export function sessionHostErrorKindForThrownCode(code: string): SessionHostErrorKind {
  return isSessionHostRefusalCode(code) ? SESSION_HOST_REFUSAL_KINDS[code] : 'internal'
}
