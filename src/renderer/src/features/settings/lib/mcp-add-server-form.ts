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

export function emptyMcpAddServerDraft(scope: McpConfigFileScope) {
  const draft: McpAddServerDraft = {
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
  return draft
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

function variablesRecord(draft: McpAddServerDraft) {
  const values: McpConfigObject = {}
  for (const row of draft.variables) {
    const key = row.key.trim()
    if (!key && !row.value.trim()) continue
    if (!key) {
      const result: VariablesResult = { ok: false, error: 'Every value needs a name.' }
      return result
    }
    if (row.secret && !canUseVaultSecrets(draft)) {
      const result: VariablesResult = {
        ok: false,
        error: "Vault secrets can only be saved in OpenWaggle's files.",
      }
      return result
    }
    if (row.secret && !row.value.trim()) {
      const result: VariablesResult = { ok: false, error: `Choose a secret for ${key}.` }
      return result
    }
    values[key] = row.secret ? { secret: row.value.trim() } : row.value
  }
  const result: VariablesResult = { ok: true, values }
  return result
}

function isHttpUrl(value: string) {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

function transportEntry(draft: McpAddServerDraft, values: McpConfigObject | null) {
  if (draft.kind === 'url') {
    const url = draft.url.trim()
    if (!isHttpUrl(url)) {
      const result: McpDraftResult = { ok: false, error: 'Enter an http or https URL.' }
      return result
    }
    const result: McpDraftResult = {
      ok: true,
      entry: { url, ...(values ? { headers: values } : {}) },
    }
    return result
  }
  const command = draft.command.trim()
  if (!command) {
    const result: McpDraftResult = { ok: false, error: 'Enter the command that starts the server.' }
    return result
  }
  const args = draft.args
    .split('\n')
    .map((arg) => arg.trim())
    .filter((arg) => arg.length > 0)
  const result: McpDraftResult = {
    ok: true,
    entry: { command, ...(args.length > 0 ? { args } : {}), ...(values ? { env: values } : {}) },
  }
  return result
}

export function buildMcpServerEntry(draft: McpAddServerDraft) {
  if (!SERVER_NAME.test(draft.name.trim())) {
    const result: McpDraftResult = {
      ok: false,
      error: 'Name the server with letters, digits, - or _.',
    }
    return result
  }
  const variables = variablesRecord(draft)
  if (!variables.ok) {
    const result: McpDraftResult = variables
    return result
  }
  const hasValues = Object.keys(variables.values).length > 0
  const transport = transportEntry(draft, hasValues ? variables.values : null)
  if (!transport.ok) {
    const result: McpDraftResult = transport
    return result
  }
  const description = draft.description.trim()
  const result: McpDraftResult = {
    ok: true,
    entry: { ...transport.entry, ...(description ? { description } : {}) },
  }
  return result
}
