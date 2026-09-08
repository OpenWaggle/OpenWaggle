export const LOCAL_SESSION_CURRENT_REVISION = 7 as const
export const LOCAL_SESSION_MCP_HOST_UI_REVISION = 6 as const
export const LOCAL_SESSION_LEGACY_HOST_UI_REVISION = 5 as const
export const LOCAL_SESSION_COMPACTION_REVISION = 4 as const
export const LOCAL_SESSION_WAGGLE_REVISION = 3 as const
/** The Host accepts only the current wire contract and its immediate predecessor. */
export const LOCAL_SESSION_SUPPORTED_REVISIONS = [
  LOCAL_SESSION_CURRENT_REVISION,
  LOCAL_SESSION_MCP_HOST_UI_REVISION,
] as const

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

export const LOCAL_SESSION_CAPABILITIES = [
  ...LOCAL_SESSION_REVISION_6_CAPABILITIES,
  'host-ui:mcp-auth-v2',
] as const
