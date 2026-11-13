import { describe, expect, it } from 'vitest'
import {
  isSessionHostErrorKind,
  SESSION_HOST_ERROR_KINDS,
  SESSION_HOST_REFUSAL_KINDS,
  type SessionHostErrorKind,
  sessionHostErrorKindForThrownCode,
  sessionHostRefusal,
} from '../session-host-refusals'

/**
 * Every refusal code and its kind, as released. From 1.0 a code keeps its kind for the whole
 * major version (ADR 0063): change an entry here only in a new major. A new code is added here
 * and in the table together, which is how the review sees the kind it was given.
 */
const RELEASED_REFUSAL_KINDS: Readonly<Record<SessionHostErrorKind, readonly string[]>> = {
  usage: [
    'amendment_reason_required',
    'claim_reason_required',
    'claim_target_invalid',
    'conflict_acknowledgement_reason_required',
    'delegation_dependency_invalid',
    'delegation_specification_invalid',
    'dependency_reason_required',
    'invalid-response-payload',
    'invalid_cursor',
    'invalid_schedule',
    'invalid_target',
    'invalid_time_zone',
    'report_empty',
    'reserved_idempotency_key',
    'submission_empty',
    'transition_reason_required',
    'verification_summary_required',
  ],
  authentication: [
    'authentication_failed',
    'authentication_throttled',
    'credential_rejected',
    'credential_required',
    'profile_not_found',
    'profile_revoked',
  ],
  authorization: [
    'authority_changed',
    'authorization_ceiling_exceeded',
    'cannot_edit_own_policy',
    'capability_denied',
    'follow_up_adopt_requires_desktop_user',
    'follow_up_edit_requires_desktop_user',
    'management_envelope_exceeded',
    'management_envelope_missing',
    'missing_access_profiles',
    'parent_required',
    'profile_credential_control_requires_local_user',
    'profile_redelegation_requires_local_user',
    'source_run_not_authorized',
    'target_not_authorized',
    'target_scope_denied',
    'worker_message_denied',
    'worker_required',
  ],
  not_found: [
    'branch_not_found',
    'delegation_amendment_proposal_not_found',
    'delegation_conflict_not_found',
    'delegation_dependency_not_found',
    'delegation_not_found',
    'export_not_found',
    'follow_up_not_found',
    'interaction-not-found',
    'lineage_target_missing',
    'session_not_found',
    'session_profile_not_found',
    'source_not_found',
    'submission_not_found',
    'target_not_found',
    'target_profile_not_found',
    'task_not_found',
  ],
  conflict: [
    'creator_identity_unsupported',
    'cursor_expired',
    'cursor_mismatch',
    'custom-renderer-unavailable',
    'delegation_amendment_proposal_mismatch',
    'delegation_amendment_proposal_not_pending',
    'delegation_amendment_proposal_stale',
    'delegation_conflict_already_acknowledged',
    'delegation_conflict_resolved',
    'delegation_dependencies_unmet',
    'delegation_dependency_exists',
    'delegation_not_accepted',
    'delegation_not_amendable',
    'delegation_not_cancellable',
    'delegation_not_contributable',
    'delegation_not_reviewable',
    'delegation_operation_invalid',
    'delegation_terminal',
    'delegation_workspace_missing',
    'follow_up_already_exists',
    'follow_up_edit_held',
    'follow_up_edit_hold_mismatch',
    'follow_up_edit_not_held',
    'follow_up_not_adoptable',
    'follow_up_not_editable',
    'follow_up_reserved',
    'heartbeat_only',
    'hive_wake_cause_may_not_wake',
    'hive_wake_not_needed',
    'host_capacity_reached',
    'host_run_ceiling_reached',
    'interaction-mismatch',
    'kind_change_not_allowed',
    'parent_capacity_reached',
    'parent_concurrency_limit_reached',
    'parent_run_changed',
    'parent_run_not_active',
    'pi_session_file_unusable',
    'profile_admission_changed',
    'profile_credential_rate_limited',
    'profile_name_exists',
    'queue_already_paused',
    'queue_already_running',
    'queue_byte_capacity_reached',
    'queue_capacity_reached',
    'queue_order_mismatch',
    'queue_revision_changed',
    'record_too_large',
    'reply_target_mismatch',
    'run_already_active',
    'run_already_in_progress',
    'run_already_stopping',
    'run_authorization_override_requires_idle_session',
    'run_changed',
    'run_not_active',
    'run_not_live',
    'run_not_scheduled',
    'run_not_starting',
    'run_not_steerable',
    'run_not_streaming',
    'schedule_ended',
    'scheduler_unavailable',
    'semantic_not_ready',
    'session_not_idle',
    'session_run_active',
    'session_worktree_missing',
    'specification_revision_stale',
    'steering_capacity_reached',
    'stop_condition_required',
    'submission_revision_stale',
    'subscription_limit_exceeded',
    'target_ambiguous',
    'target_is_source',
    'target_profile_revoked',
    'target_session_change_not_allowed',
    'targets_empty',
    'task_limit_reached',
    'thinking_level_requires_idle_session',
    'wake_check_changed',
    'workspace_base_ref_mismatch',
    'workspace_unavailable',
  ],
  timeout: ['handshake_timeout', 'interaction-timeout'],
  host_unavailable: ['host_draining', 'host_lost', 'host_stopped'],
  resync_required: ['resync_required'],
  internal: [
    'attachment_resolution_failed',
    'command_failed',
    'export_failed',
    'inbound_backpressure_exceeded',
    'invalid_frame',
    'protocol_error',
    'steering_failed',
    'workspace_snapshot_failed',
    'workspace_target_transfer_failed',
  ],
}

describe('Session Host refusal kinds (ADR 0063)', () => {
  it('gives every refusal code exactly the kind it was released with', () => {
    const byKind = Object.fromEntries(
      SESSION_HOST_ERROR_KINDS.map((kind) => [
        kind,
        Object.entries(SESSION_HOST_REFUSAL_KINDS)
          .filter(([, codeKind]) => codeKind === kind)
          .map(([code]) => code)
          .sort(),
      ]),
    )

    expect(byKind).toEqual(RELEASED_REFUSAL_KINDS)
  })

  it('lists the kinds in their documented order', () => {
    expect(SESSION_HOST_ERROR_KINDS).toEqual([
      'usage',
      'authentication',
      'authorization',
      'not_found',
      'conflict',
      'timeout',
      'host_unavailable',
      'resync_required',
      'internal',
    ])
    expect(SESSION_HOST_ERROR_KINDS.every(isSessionHostErrorKind)).toBe(true)
    expect(isSessionHostErrorKind('not-found')).toBe(false)
  })

  it('builds a refusal with the kind from the table', () => {
    expect(sessionHostRefusal('management_envelope_missing')).toEqual({
      code: 'management_envelope_missing',
      kind: 'authorization',
    })
    expect(sessionHostRefusal('session_worktree_missing')).toEqual({
      code: 'session_worktree_missing',
      kind: 'conflict',
    })
  })

  it('reads a thrown code from the table, and any other code as internal', () => {
    expect(sessionHostErrorKindForThrownCode('capability_denied')).toBe('authorization')
    expect(sessionHostErrorKindForThrownCode('pi_session_file_unusable')).toBe('conflict')
    // Wording never decides: an unlisted code that reads like a known kind is still internal.
    for (const code of ['widget_not_found', 'request_timeout', 'access_denied', 'constructor']) {
      expect(sessionHostErrorKindForThrownCode(code)).toBe('internal')
    }
  })
})
