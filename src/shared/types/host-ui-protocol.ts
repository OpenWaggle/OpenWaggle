import type { IpcInvokeChannel } from './ipc'

export const HOST_UI_CONTRACT_VERSION = 1 as const
/**
 * Bounded Session reads ship with revision 29: the Host-side tree filter and one read for every
 * turn's changed files.
 */
export const HOST_UI_REVISION_29_REQUIRED_CHANNELS = [
  'sessions:search-tree',
  'sessions:turn-diff-files:list',
] as const satisfies readonly IpcInvokeChannel[]
/**
 * Arguments existing channels gained in revision 29: the detail's cursor, which returns only
 * appended messages, the workspace's window and cached-node request, and the provider catalog's
 * scope, which reads only the available providers unless Settings asks for all (B14).
 */
export const HOST_UI_REVISION_29_ARGUMENT_COUNTS = {
  'providers:get-models': 2,
  'sessions:get-detail': 2,
  'sessions:get-workspace': 3,
} as const satisfies Partial<Record<IpcInvokeChannel, number>>
/**
 * Settings > Archived items ships with revision 25: one searchable, faceted list of archived
 * sessions and branches, its Select all, and restoring many items (or undoing that) in one call.
 */
export const HOST_UI_REVISION_25_REQUIRED_CHANNELS = [
  'sessions:query-archived-items',
  'sessions:list-archived-item-refs',
  'sessions:set-archived-items',
  'sessions:delete-archived-sessions',
] as const satisfies readonly IpcInvokeChannel[]
/**
 * Settings > MCP and the `openwaggle mcp` management commands over Pi's MCP files (ADR 0051),
 * including MCP Registry search and install, MCP App resource and prompt listing, and the
 * per-Session MCP switch, ship with revision 24.
 */
export const HOST_UI_REVISION_24_REQUIRED_CHANNELS = [
  'mcp:get-configuration',
  'mcp:set-server-enabled',
  'mcp:set-server-exposure',
  'mcp:add-server',
  'mcp:remove-server',
  'mcp:inspect-server',
  'mcp:get-server-statuses',
  'mcp:sign-in',
  'mcp:sign-out',
  'mcp:install-catalog-server',
  'mcp:preview-imports',
  'mcp:apply-imports',
  'mcp:search-registry',
  'mcp:get-registry-server',
  'mcp:install-registry-server',
  'mcp:list-app-catalog',
  'mcp:get-session-enabled',
  'mcp:set-session-enabled',
] as const satisfies readonly IpcInvokeChannel[]
/** Pausing Pi session discovery for a project removal ships with revision 24 (ADR 0051). */
export const HOST_UI_REVISION_24_SESSION_CHANNELS = [
  'sessions:begin-project-removal',
] as const satisfies readonly IpcInvokeChannel[]
/** Listing a Session's Pi extension commands for the slash menu ships with revision 24. */
export const HOST_UI_REVISION_24_AGENT_CHANNELS = [
  'agent:list-extension-commands',
] as const satisfies readonly IpcInvokeChannel[]
/**
 * Arguments existing channels gained in revision 24: `sessions:delete`'s second argument says the
 * Session is deleted as part of removing its project, which keeps a discovered Pi file listable.
 */
export const HOST_UI_REVISION_24_ARGUMENT_COUNTS = {
  'sessions:delete': 2,
} as const satisfies Partial<Record<IpcInvokeChannel, number>>
/**
 * Session-coupled source-control operations ship with revision 23 (ADR 0048): the window's
 * database is isolated, so the Change request inspector, merges, Session working-path checks,
 * and Git Output recording run in the Session Host.
 */
export const HOST_UI_REVISION_23_REQUIRED_CHANNELS = [
  'git:change-request:panel',
  'git:change-request:merge-candidate',
  'git:change-request:merge-confirmed',
  'git:session:verify-working-path',
  'git:session:record-outputs',
  'source-control:patch-settings',
] as const satisfies readonly IpcInvokeChannel[]
/** Session settings channels (thinking level as Session state) ship with revision 21. */
export const HOST_UI_REVISION_21_REQUIRED_CHANNELS = [
  'sessions:set-thinking-level',
  'sessions:get-default-thinking-level',
  'sessions:set-default-thinking-level',
] as const satisfies readonly IpcInvokeChannel[]
/**
 * Arguments existing channels gained in revision 21, as the argument count that needs it:
 * `sessions:create`'s fourth argument is the thinking level the new Session starts at. A
 * revision-20 Host refuses it, so a request carrying it requires revision 21.
 */
export const HOST_UI_REVISION_21_ARGUMENT_COUNTS = {
  'sessions:create': 4,
} as const satisfies Partial<Record<IpcInvokeChannel, number>>
/** Title regeneration ships with revision 20. */
export const HOST_UI_REVISION_20_REQUIRED_CHANNELS = [
  'sessions:regenerate-title',
] as const satisfies readonly IpcInvokeChannel[]
export const HOST_UI_REVISION_17_REQUIRED_CHANNELS = [
  'project-actions:manage',
  'project-config:get-preferences',
  'project-config:set-preferences',
  'project-config:remove-project-model',
  'authorization-grants:grant',
  'authorization-grants:revoke',
  'sessions:set-model',
] as const satisfies readonly IpcInvokeChannel[]
export const HOST_UI_REVISION_16_REQUIRED_CHANNELS = [
  'sessions:resources:list',
  'sessions:resources:page',
  'sessions:resources:get',
  'sessions:resources:locate-image',
  'sessions:resources:node-page',
  'sessions:resources:list-by-node-ids',
  'sessions:resources:backfill',
  'sessions:resources:host-content',
  'sessions:resources:thumbnail',
  'sessions:resources:retry',
  'sessions:resources:record-change-request',
] as const satisfies readonly IpcInvokeChannel[]
export const HOST_UI_REVISION_13_REQUIRED_CHANNELS = [
  'sessions:turn-diff-files:get',
] as const satisfies readonly IpcInvokeChannel[]

export const HOST_UI_REVISION_12_REQUIRED_CHANNELS = [
  'sessions:list-projects',
] as const satisfies readonly IpcInvokeChannel[]

export const HOST_UI_REVISION_11_REQUIRED_CHANNELS = [
  'agent-definitions:list-display',
  'agent-definitions:get-preview',
  'agent-definitions:set-enabled',
] as const satisfies readonly IpcInvokeChannel[]

export const HOST_UI_REVISION_10_REQUIRED_CHANNELS = [
  'authorization-grants:grant',
  'authorization-grants:revoke',
] as const satisfies readonly IpcInvokeChannel[]

export const HOST_UI_REVISION_9_REQUIRED_CHANNELS = [
  'workspace-files:authorize-project',
  'inline-visualization:prepare-source',
] as const satisfies readonly IpcInvokeChannel[]

export const HOST_UI_REVISION_7_REQUIRED_CHANNELS = [
  'agent:list-active-runs',
] as const satisfies readonly IpcInvokeChannel[]

/** Channels introduced in revision 7. Changed channels may still have a legacy dispatcher. */
export const HOST_UI_REVISION_7_NEW_CHANNELS = [
  'agent:list-active-runs',
] as const satisfies readonly IpcInvokeChannel[]

/**
 * MCP operations the Session Host owns after ADR 0051: the secret vault and the MCP App resource
 * read and tool call (revision 6), and the MCP configuration operations (revision 24).
 */
export const HOST_BACKED_MCP_GUI_CHANNELS = [
  ...HOST_UI_REVISION_24_REQUIRED_CHANNELS,
  'mcp:list-secrets',
  'mcp:set-secret',
  'mcp:remove-secret',
  'mcp:read-resource',
  'mcp:call-app-tool',
] as const satisfies readonly IpcInvokeChannel[]

/**
 * Closed set of renderer operations whose authority lives in the Session Host.
 * Adding a channel is a protocol change and must be reviewed alongside its Host dispatcher.
 */
export const HOST_BACKED_GUI_CHANNELS = [
  ...HOST_UI_REVISION_29_REQUIRED_CHANNELS,
  ...HOST_UI_REVISION_25_REQUIRED_CHANNELS,
  ...HOST_UI_REVISION_24_SESSION_CHANNELS,
  ...HOST_UI_REVISION_23_REQUIRED_CHANNELS,
  ...HOST_UI_REVISION_21_REQUIRED_CHANNELS,
  ...HOST_UI_REVISION_20_REQUIRED_CHANNELS,
  ...HOST_UI_REVISION_17_REQUIRED_CHANNELS,
  ...HOST_UI_REVISION_16_REQUIRED_CHANNELS,
  ...HOST_UI_REVISION_13_REQUIRED_CHANNELS,
  ...HOST_UI_REVISION_12_REQUIRED_CHANNELS,
  ...HOST_UI_REVISION_11_REQUIRED_CHANNELS,
  ...HOST_UI_REVISION_10_REQUIRED_CHANNELS,
  ...HOST_UI_REVISION_9_REQUIRED_CHANNELS,
  'agent:list-active-runs',
  'agent:get-context-usage',
  ...HOST_UI_REVISION_24_AGENT_CHANNELS,
  'sessions:get-detail',
  'sessions:create',
  'sessions:fork-to-new',
  'sessions:clone-to-new',
  'sessions:dismiss-interrupted-run',
  'sessions:delete',
  'sessions:archive',
  'sessions:unarchive',
  'sessions:update-title',
  'sessions:set-authorization-mode',
  'sessions:list-by-ids',
  'sessions:list-page',
  'sessions:list-hive-page',
  'sessions:list-hive-tree-page',
  'sessions:list-archived-branches',
  'sessions:get-tree',
  'sessions:get-workspace',
  'sessions:navigate-tree',
  'sessions:rename-branch',
  'sessions:archive-branch',
  'sessions:restore-branch',
  'sessions:update-tree-ui-state',
  'sessions:turn-checkpoints:list',
  'sessions:turn-diff:get',
  'sessions:pins:list',
  'sessions:pins:pin',
  'sessions:pins:unpin',
  'sessions:pins:move',
  'settings:get',
  'settings:update',
  'settings:set-enabled-models',
  'settings:test-api-key',
  'extensions:list-packages',
  'extensions:list-contributions',
  'extensions:propose-package-write',
  'extensions:apply-package-write',
  'extensions:propose-package-remove',
  'extensions:apply-package-remove',
  'extensions:invoke',
  'extensions:set-trusted',
  'extensions:set-enabled',
  'extensions:set-project-disabled',
  'extensions:accept-update',
  'extensions:approve-build',
  'extensions:reload',
  'extensions:authorize-runtime-module',
  'providers:get-models',
  'project-config:set-preferences',
  'project-config:remove-project-model',
  'docs:discover',
  'agent-definitions:manage',
  'skills:list',
  'skills:set-enabled',
  'skills:get-preview',
  'git:worktrees:create',
  'git:worktrees:remove',
  ...HOST_BACKED_MCP_GUI_CHANNELS,
] as const satisfies readonly IpcInvokeChannel[]

export type HostBackedGuiChannel = (typeof HOST_BACKED_GUI_CHANNELS)[number]
export type HostBackedMcpGuiChannel = (typeof HOST_BACKED_MCP_GUI_CHANNELS)[number]

export type HostUiWireValue =
  | { readonly kind: 'undefined' }
  /** Value is validated as JSON-compatible before crossing the framed transport. */
  | { readonly kind: 'value'; readonly value: unknown }

export interface HostUiV1Request {
  readonly contractVersion: typeof HOST_UI_CONTRACT_VERSION
  readonly requestId: string
  readonly channel: HostBackedGuiChannel
  readonly args: readonly HostUiWireValue[]
}

export interface HostUiV1Result {
  readonly contractVersion: typeof HOST_UI_CONTRACT_VERSION
  readonly requestId: string
  readonly channel: HostBackedGuiChannel
  readonly result: HostUiWireValue
}
