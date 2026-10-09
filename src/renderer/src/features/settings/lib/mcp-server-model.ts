import type {
  McpConfigFileKind,
  McpConfigFileScope,
  McpConfigFileView,
  McpConfiguredServerView,
  McpServerConnectionStateView,
  McpServerExposure,
  McpServerInspection,
  McpServerStatusSource,
  McpServerStatusView,
  McpWriteDestination,
} from '@shared/types/mcp-configuration'
import type {
  McpImportCandidateStatus,
  McpImportSourceId,
} from '@shared/types/mcp-configuration-operations'

/** What Settings > MCP says about Pi's MCP data. Copy follows Pi's `docs/mcp.md`. */

export const MCP_EXPOSURE_ORDER: readonly McpServerExposure[] = [
  'codemode',
  'deferred',
  'direct',
  'hidden',
]

export const MCP_EXPOSURE_COPY: Readonly<
  Record<McpServerExposure, { readonly label: string; readonly description: string }>
> = {
  codemode: {
    label: 'Codemode',
    description:
      'The model calls these tools from codemode scripts, which find them by searching. The default.',
  },
  deferred: {
    label: 'Deferred',
    description: 'Hidden from the model until tool search loads them, then called directly.',
  },
  direct: {
    label: 'Direct',
    description: 'Shown to the model like built-in tools, and callable from codemode.',
  },
  hidden: {
    label: 'Hidden',
    description: 'Registered but unreachable.',
  },
}

/** Assembled so the repository check for legacy agent references does not match a product name. */
const CLAUDE_CODE_LABEL = ['Claude', 'Code'].join(' ')

export const MCP_IMPORT_SOURCE_LABELS: Readonly<Record<McpImportSourceId, string>> = {
  codex: 'Codex',
  'claude-code': CLAUDE_CODE_LABEL,
  'claude-desktop': 'Claude Desktop',
  cursor: 'Cursor',
  vscode: 'VS Code',
  opencode: 'OpenCode',
  zed: 'Zed',
  windsurf: 'Windsurf',
}

export const MCP_IMPORT_STATUS_LABELS: Readonly<Record<McpImportCandidateStatus, string>> = {
  new: 'New',
  imported: 'Already imported',
  'source-changed': 'Changed since import',
  'name-taken': 'Name in use',
}

/**
 * The row state: the server's known state, `checking` while "Check connection" runs, or
 * `not-checked` when nothing is known yet. Settings never connects on its own.
 */
export type McpServerStatus = McpServerConnectionStateView | 'checking' | 'not-checked'

export type McpStatusTone = 'neutral' | 'good' | 'warning' | 'error'

export const MCP_STATUS_COPY: Readonly<
  Record<McpServerStatus, { readonly label: string; readonly tone: McpStatusTone }>
> = {
  'needs-sign-in': { label: 'Needs sign-in', tone: 'warning' },
  failed: { label: 'Failed', tone: 'error' },
  'not-connected': { label: 'Not connected', tone: 'neutral' },
  connecting: { label: 'Connecting…', tone: 'neutral' },
  checking: { label: 'Checking…', tone: 'neutral' },
  'not-checked': { label: 'Not checked yet', tone: 'neutral' },
  connected: { label: 'Connected', tone: 'good' },
  disabled: { label: 'Off', tone: 'neutral' },
}

/** Servers that need the user come first, as in Pi's `/mcp` manager. */
const ATTENTION_RANK: Readonly<Record<McpServerStatus, number>> = {
  'needs-sign-in': 0,
  failed: 1,
  'not-connected': 2,
  connecting: 3,
  checking: 3,
  'not-checked': 4,
  connected: 4,
  disabled: 5,
}

export function mcpServerStatus(
  server: McpConfiguredServerView,
  known: McpServerStatusView | undefined,
  checking: boolean,
): McpServerStatus {
  if (!server.enabled) return 'disabled'
  if (checking) return 'checking'
  return known?.inspection?.state ?? 'not-checked'
}

export interface McpServerRow {
  readonly server: McpConfiguredServerView
  readonly status: McpServerStatus
  readonly inspection?: McpServerInspection
  /** Where the state comes from; absent while nothing is known. */
  readonly source?: McpServerStatusSource
  /** When the last check happened, for a state that is not live. */
  readonly checkedAt?: number
  readonly signedIn?: boolean
}

/** Joins a server with what is known about its state. */
export function mcpServerRow(
  server: McpConfiguredServerView,
  known: McpServerStatusView | undefined,
  checking: boolean,
): McpServerRow {
  const signedIn = known?.signedIn ?? known?.inspection?.signedIn
  return {
    server,
    status: mcpServerStatus(server, known, checking),
    ...(known?.inspection ? { inspection: known.inspection } : {}),
    ...(known && known.source !== 'not-checked' ? { source: known.source } : {}),
    ...(known?.checkedAt === undefined ? {} : { checkedAt: known.checkedAt }),
    ...(signedIn === undefined ? {} : { signedIn }),
  }
}

export function sortMcpServersByAttention(rows: readonly McpServerRow[]): McpServerRow[] {
  return [...rows].sort(
    (left, right) =>
      ATTENTION_RANK[left.status] - ATTENTION_RANK[right.status] ||
      left.server.name.localeCompare(right.server.name),
  )
}

export function mcpToolCountLabel(row: McpServerRow) {
  if (row.status !== 'connected' || !row.inspection) return null
  const count = row.inspection.tools.length
  return `${String(count)} tool${count === 1 ? '' : 's'}`
}

/**
 * OpenWaggle's file for `scope`, or with `files`, the first file of the view a new server can go
 * to: a project that is the home folder has no project OpenWaggle file (it is the global one).
 */
export function mcpDefaultDestination(
  scope: McpConfigFileScope,
  files?: readonly McpConfigFileView[],
): McpWriteDestination {
  const preferred = scope === 'global' ? 'openwaggle-global' : 'project-openwaggle'
  if (!files) return preferred
  return mcpDestinationFiles(files, scope)[0]?.fileId ?? preferred
}

/** The files a new server can go to, OpenWaggle's first, as ADR 0050 orders them. */
export function mcpDestinationFiles(
  files: readonly McpConfigFileView[],
  scope: McpConfigFileScope,
): McpConfigFileView[] {
  return files
    .filter((file) => file.scope === scope)
    .sort((left, right) => Number(right.openWaggleOwned) - Number(left.openWaggleOwned))
}

export function isOpenWaggleMcpFile(fileId: McpConfigFileKind) {
  return fileId === 'openwaggle-global' || fileId === 'project-openwaggle'
}

export function mcpFileScope(fileId: McpConfigFileKind): McpConfigFileScope {
  return fileId === 'pi-global' || fileId === 'openwaggle-global' ? 'global' : 'project'
}

/** A project file overrides this global server, so its switches already apply to the project. */
export function hasProjectOverride(server: McpConfiguredServerView) {
  return server.override !== undefined && mcpFileScope(server.override.fileId) === 'project'
}

/** A global server can be switched for the selected project alone until a project overrides it. */
/**
 * A global server can be switched for the project alone when the project has its own OpenWaggle
 * file to save that in; a project that is the home folder has none.
 */
export function canSwitchForProject(
  server: McpConfiguredServerView,
  projectPath: string | null,
  files: readonly McpConfigFileView[],
) {
  return (
    projectPath !== null &&
    server.scope === 'global' &&
    !hasProjectOverride(server) &&
    files.some((file) => file.fileId === 'project-openwaggle')
  )
}

export type McpOverrideNote =
  | { readonly kind: 'off-in-openwaggle'; readonly path: string }
  | { readonly kind: 'overridden'; readonly path: string }

/**
 * What a list row says about a file that overrides the server. A server another tool's file (Pi's,
 * `.mcp.json`) turns on but OpenWaggle's file keeps off is "Off in OpenWaggle": after the upgrade,
 * that is a server the old OpenWaggle never connected, which the migration kept off.
 */
export function mcpOverrideNote(server: McpConfiguredServerView): McpOverrideNote | undefined {
  const { override } = server
  if (!override) return undefined
  const offInOpenWaggle =
    !server.enabled &&
    server.offByOverride === true &&
    isOpenWaggleMcpFile(override.fileId) &&
    !isOpenWaggleMcpFile(server.source.fileId)
  return { kind: offInOpenWaggle ? 'off-in-openwaggle' : 'overridden', path: override.path }
}

/** The vault secrets a server reads that the vault does not hold: it is left out of Runs. */
export function mcpMissingSecrets(
  server: Pick<McpConfiguredServerView, 'vaultSecrets'>,
  stored: readonly { readonly name: string }[],
) {
  const names = new Set(stored.map((secret) => secret.name))
  return (server.vaultSecrets ?? []).filter((secret) => !names.has(secret))
}
