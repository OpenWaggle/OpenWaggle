export const LOCAL_SESSION_CURRENT_REVISION = 21 as const
export const LOCAL_SESSION_FOLLOW_UP_EDIT_REVISION = 21 as const
export const LOCAL_SESSION_SESSION_SETTINGS_REVISION = 21 as const
export const LOCAL_SESSION_TITLE_REGENERATION_REVISION = 20 as const
export const LOCAL_SESSION_HOST_CONTROL_REVISION = 19 as const
export const LOCAL_SESSION_LAUNCH_STEPS_REVISION = 18 as const
export const LOCAL_SESSION_NATIVE_ACTIONS_REVISION = 17 as const
export const LOCAL_SESSION_RESOURCE_HOST_UI_REVISION = 16 as const
export const LOCAL_SESSION_WORKTREE_LAUNCH_REVISION = 15 as const
export const LOCAL_SESSION_UPDATE_REVISION = 14 as const
export const LOCAL_SESSION_TURN_DIFF_FILES_REVISION = 13 as const
export const LOCAL_SESSION_PROJECT_CATALOG_REVISION = 12 as const
export const LOCAL_SESSION_DESKTOP_SERVICE_REVISION = 11 as const
export const LOCAL_SESSION_AUTHORIZATION_GRANTS_REVISION = 10 as const
export const LOCAL_SESSION_WORKSPACE_AUTHORIZATION_REVISION = 9 as const
export const LOCAL_SESSION_STEERING_RECEIPT_REVISION = 8 as const
export const LOCAL_SESSION_MCP_AUTH_REVISION = 7 as const
export const LOCAL_SESSION_MCP_HOST_UI_REVISION = 6 as const
export const LOCAL_SESSION_LEGACY_HOST_UI_REVISION = 5 as const
export const LOCAL_SESSION_COMPACTION_REVISION = 4 as const
export const LOCAL_SESSION_WAGGLE_REVISION = 3 as const
/**
 * Revision 17 removes legacy action commands (ADR 0035). Revision 18 adds labelled launch steps,
 * local launches, and their new stages to worktree launch events and Run snapshots, which a
 * revision-17 client decodes exactly and would reject mid-stream; older clients must upgrade.
 * Revision 19 adds the `local-host-v1` stop command used by `openwaggle host stop` (ADR 0039).
 * Revision 20 adds the `sessions:regenerate-title` Host UI channel for Title regeneration (ADR 0043).
 * Revision 21 adds Follow-up edits (ADR 0044): the `queue-edit-begin`, `queue-edit-save`, and
 * `queue-edit-cancel` Session Control operations and the `renew-follow-up-edit-hold` Local UI
 * command. A revision-21 desktop app refuses an older Host at the handshake, and each of these
 * commands is revision-gated too, so none reaches a Host that cannot hold a Follow-up. Revision 21
 * also makes the thinking level Session state: the `sessions:set-thinking-level` and default
 * thinking-level Host UI channels, a Follow-up that carries no thinking level or Run authorization
 * override, `message` accepting both only when it starts a Run, no `queue-update-authorization`,
 * and the desktop-only `queue-adopt` that sends a needs-attention Follow-up as the user.
 */
export const LOCAL_SESSION_SUPPORTED_REVISIONS = [LOCAL_SESSION_CURRENT_REVISION] as const

export const LOCAL_SESSION_REVISION_2_CAPABILITIES = [
  'events:subscribe',
  'events:replay',
  'sessions:mutate-v2',
  'sessions:query-v2',
  'sessions:snapshot',
  'access:profiles-v1',
  'ui:mutate-v1',
] as const

export const LOCAL_SESSION_REVISION_3_CAPABILITIES = [
  ...LOCAL_SESSION_REVISION_2_CAPABILITIES,
  'waggle:run-v1',
  'waggle:cancel-v1',
] as const

export const LOCAL_SESSION_REVISION_4_CAPABILITIES = [
  ...LOCAL_SESSION_REVISION_3_CAPABILITIES,
  'ui:compact-v1',
] as const

export const LOCAL_SESSION_REVISION_5_CAPABILITIES = [
  ...LOCAL_SESSION_REVISION_4_CAPABILITIES,
  'host-ui:invoke-v1',
] as const

export const LOCAL_SESSION_REVISION_6_CAPABILITIES = [
  ...LOCAL_SESSION_REVISION_5_CAPABILITIES,
] as const

export const LOCAL_SESSION_REVISION_7_CAPABILITIES = [
  ...LOCAL_SESSION_REVISION_6_CAPABILITIES,
  'host-ui:mcp-auth-v2',
] as const

export const LOCAL_SESSION_REVISION_8_CAPABILITIES = [
  ...LOCAL_SESSION_REVISION_7_CAPABILITIES,
  'sessions:steer-receipt-v1',
] as const

export const LOCAL_SESSION_REVISION_9_CAPABILITIES = [
  ...LOCAL_SESSION_REVISION_8_CAPABILITIES,
  'host-ui:workspace-authorization-v1',
  'host-ui:visualization-source-v1',
] as const

export const LOCAL_SESSION_REVISION_10_CAPABILITIES = [
  ...LOCAL_SESSION_REVISION_9_CAPABILITIES,
  'host-ui:authorization-grants-v1',
] as const

export const LOCAL_SESSION_REVISION_11_CAPABILITIES = [
  ...LOCAL_SESSION_REVISION_10_CAPABILITIES,
  'desktop:services-v1',
] as const

export const LOCAL_SESSION_REVISION_12_CAPABILITIES = [
  ...LOCAL_SESSION_REVISION_11_CAPABILITIES,
  'host-ui:session-project-catalog-v1',
] as const

export const LOCAL_SESSION_REVISION_13_CAPABILITIES = [
  ...LOCAL_SESSION_REVISION_12_CAPABILITIES,
  'host-ui:turn-diff-files-v1',
] as const

export const LOCAL_SESSION_REVISION_14_CAPABILITIES = [
  ...LOCAL_SESSION_REVISION_13_CAPABILITIES,
  'updates:channel-v1',
] as const

export const LOCAL_SESSION_REVISION_15_CAPABILITIES = [
  ...LOCAL_SESSION_REVISION_14_CAPABILITIES,
  'events:worktree-launch-v1',
] as const

export const LOCAL_SESSION_REVISION_16_CAPABILITIES = [
  ...LOCAL_SESSION_REVISION_15_CAPABILITIES,
  'host-ui:session-resources-v1',
] as const

export const LOCAL_SESSION_REVISION_17_CAPABILITIES = [
  ...LOCAL_SESSION_REVISION_16_CAPABILITIES,
  'host-ui:native-actions-v1',
  'host-ui:project-model-persistence-v1',
] as const

export const LOCAL_SESSION_REVISION_18_CAPABILITIES = [
  ...LOCAL_SESSION_REVISION_17_CAPABILITIES,
  'events:launch-steps-v1',
] as const

export const LOCAL_SESSION_REVISION_19_CAPABILITIES = [
  ...LOCAL_SESSION_REVISION_18_CAPABILITIES,
  'host:stop-v1',
] as const

export const LOCAL_SESSION_REVISION_20_CAPABILITIES = [
  ...LOCAL_SESSION_REVISION_19_CAPABILITIES,
  'host-ui:session-title-regeneration-v1',
] as const

export const LOCAL_SESSION_REVISION_21_CAPABILITIES = [
  ...LOCAL_SESSION_REVISION_20_CAPABILITIES,
  'sessions:follow-up-edit-v1',
] as const

export const LOCAL_SESSION_CAPABILITIES = LOCAL_SESSION_REVISION_21_CAPABILITIES
