import type { IpcInvokeChannel } from './ipc'

export const HOST_UI_CONTRACT_VERSION = 1 as const

/**
 * Closed set of renderer operations whose authority lives in the Session Host.
 * Adding a channel is a protocol change and must be reviewed alongside its Host dispatcher.
 */
export const HOST_BACKED_GUI_CHANNELS = [
  'agent:get-context-usage',
  'sessions:list-details',
  'sessions:get-detail',
  'sessions:create',
  'sessions:fork-to-new',
  'sessions:clone-to-new',
  'sessions:dismiss-interrupted-run',
  'sessions:delete',
  'sessions:archive',
  'sessions:unarchive',
  'sessions:list-archived',
  'sessions:update-title',
  'sessions:set-authorization-mode',
  'sessions:list',
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
  'docs:discover',
  'agent-definitions:manage',
  'skills:list',
  'skills:set-enabled',
  'skills:get-preview',
  'git:worktrees:create',
  'git:worktrees:remove',
] as const satisfies readonly IpcInvokeChannel[]

export type HostBackedGuiChannel = (typeof HOST_BACKED_GUI_CHANNELS)[number]

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
