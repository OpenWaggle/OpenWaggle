import type { McpConfigObject } from '@shared/types/mcp'
import type { McpConfigFileScope, McpWriteDestination } from '@shared/types/mcp-configuration'
import type { McpServerEntryInput } from '@shared/types/mcp-configuration-operations'
import { isOpenWaggleMcpFile, mcpDefaultDestination } from './mcp-server-model'

/** The Add server form, and the Pi `mcpServers` entry it saves. */

export interface McpKeyValueRow {
  readonly id: string
  readonly key: string
  readonly value: string
  /** The value names a vault secret instead of holding the text itself. */
  readonly secret: boolean
}

export interface McpAddServerDraft {
  readonly name: string
  readonly kind: 'command' | 'url'
  readonly command: string
  /** One argument per line. */
  readonly args: string
  readonly url: string
  readonly variables: readonly McpKeyValueRow[]
  readonly description: string
  readonly scope: McpConfigFileScope
  readonly destination: McpWriteDestination
}

const SERVER_NAME = /^[A-Za-z0-9_-]+$/

export function emptyMcpAddServerDraft(scope: McpConfigFileScope): McpAddServerDraft {
  return {
    name: '',
    kind: 'command',
    command: '',
    args: '',
    url: '',
    variables: [],
    description: '',
    scope,
    destination: mcpDefaultDestination(scope),
  }
}

/** Secret values can only be saved in OpenWaggle's files, which Pi and other tools never read. */
export function canUseVaultSecrets(draft: Pick<McpAddServerDraft, 'destination'>) {
  return isOpenWaggleMcpFile(draft.destination)
}

export type McpDraftResult =
  | { readonly ok: true; readonly entry: McpServerEntryInput }
  | { readonly ok: false; readonly error: string }

type VariablesResult =
  | { readonly ok: true; readonly values: McpConfigObject }
  | { readonly ok: false; readonly error: string }

function variablesRecord(draft: McpAddServerDraft): VariablesResult {
  const values: McpConfigObject = {}
  for (const row of draft.variables) {
    const key = row.key.trim()
    if (!key && !row.value.trim()) continue
    if (!key) return { ok: false, error: 'Every value needs a name.' }
    if (row.secret && !canUseVaultSecrets(draft)) {
      return { ok: false, error: "Vault secrets can only be saved in OpenWaggle's files." }
    }
    if (row.secret && !row.value.trim()) return { ok: false, error: `Choose a secret for ${key}.` }
    values[key] = row.secret ? { secret: row.value.trim() } : row.value
  }
  return { ok: true, values }
}

function isHttpUrl(value: string) {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

export function buildMcpServerEntry(draft: McpAddServerDraft): McpDraftResult {
  if (!SERVER_NAME.test(draft.name.trim())) {
    return { ok: false, error: 'Name the server with letters, digits, - or _.' }
  }
  const variables = variablesRecord(draft)
  if (!variables.ok) return variables
  const hasValues = Object.keys(variables.values).length > 0
  const entry: McpConfigObject = {}
  if (draft.kind === 'url') {
    const url = draft.url.trim()
    if (!isHttpUrl(url)) return { ok: false, error: 'Enter an http or https URL.' }
    entry.url = url
    if (hasValues) entry.headers = variables.values
  } else {
    const command = draft.command.trim()
    if (!command) return { ok: false, error: 'Enter the command that starts the server.' }
    const args = draft.args
      .split('\n')
      .map((arg) => arg.trim())
      .filter((arg) => arg.length > 0)
    entry.command = command
    if (args.length > 0) entry.args = args
    if (hasValues) entry.env = variables.values
  }
  const description = draft.description.trim()
  if (description) entry.description = description
  return { ok: true, entry }
}
