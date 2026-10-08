/**
 * Text edits of an `mcp.json` that keep the file as its owner wrote it. `.mcp.json` and
 * `.pi/mcp.json` are often committed, so a change touches only the keys it changes: other content,
 * unknown fields, key order, indentation, line endings, compact one-line files, and the file mode
 * all stay as they were. In a multi-line file, an entry written on one line is spread over lines
 * when a key is added to it, in the file's indentation.
 */
import { randomUUID } from 'node:crypto'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'
import { applyEdits, type FormattingOptions, type JSONPath, modify } from 'jsonc-parser'
import { isJsonRecord } from '../../../domain/mcp/config/mcp-server-config'
import { mcpFileWriteTarget } from './mcp-file-write-target'

type JsonRecord = Record<string, unknown>

const DEFAULT_INDENT = '  '
const NEW_FILE_MODE = 0o600
/** `st_mode` modulo this is the permission bits. */
const PERMISSION_MODULUS = 0o1000

function parseFile(filePath: string, text: string | undefined): JsonRecord {
  const parsed: unknown = text === undefined || !text.trim() ? {} : JSON.parse(text)
  if (
    !isJsonRecord(parsed) ||
    (parsed.mcpServers !== undefined && !isJsonRecord(parsed.mcpServers))
  ) {
    throw new Error(`${filePath}: expected an object with an "mcpServers" object`)
  }
  return parsed
}

/** Inserted values follow the file's layout; a one-line file gets one-line values. */
function formattingOf(text: string): FormattingOptions | undefined {
  if (!text.trim().includes('\n')) return undefined
  const indent = /^([ \t]+)\S/m.exec(text)?.[1] ?? DEFAULT_INDENT
  return {
    insertSpaces: !indent.includes('\t'),
    tabSize: indent.includes('\t') ? 1 : indent.length,
    eol: text.includes('\r\n') ? '\r\n' : '\n',
  }
}

function same(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right)
}

/** The smallest set of (path, value) changes from `before` to `after`; undefined removes a key. */
function serverChanges(before: JsonRecord, after: JsonRecord) {
  const changes: { readonly path: JSONPath; readonly value: unknown }[] = []
  for (const name of new Set([...Object.keys(before), ...Object.keys(after)])) {
    const old = before[name]
    const next = after[name]
    if (same(old, next)) continue
    if (!isJsonRecord(old) || !isJsonRecord(next)) {
      changes.push({ path: ['mcpServers', name], value: next })
      continue
    }
    for (const key of new Set([...Object.keys(old), ...Object.keys(next)])) {
      if (!same(old[key], next[key]))
        changes.push({ path: ['mcpServers', name, key], value: next[key] })
    }
  }
  return changes
}

function editedText(text: string, before: JsonRecord | undefined, after: JsonRecord) {
  if (!text.trim()) return `${JSON.stringify({ mcpServers: after }, null, DEFAULT_INDENT)}\n`
  const formattingOptions = formattingOf(text)
  const changes = before ? serverChanges(before, after) : [{ path: ['mcpServers'], value: after }]
  return changes.reduce(
    (current, change) =>
      applyEdits(current, modify(current, change.path, change.value, { formattingOptions })),
    text,
  )
}

function writeAtomically(linkOrFile: string, content: string) {
  const filePath = mcpFileWriteTarget(linkOrFile)
  mkdirSync(path.dirname(filePath), { recursive: true })
  const mode = existsSync(filePath) ? statSync(filePath).mode % PERMISSION_MODULUS : NEW_FILE_MODE
  const temporaryPath = `${filePath}.${randomUUID()}.tmp`
  try {
    writeFileSync(temporaryPath, content, { mode })
    // The umask applies to `mode` above; a group-writable file must stay group-writable.
    chmodSync(temporaryPath, mode)
    renameSync(temporaryPath, filePath)
  } catch (error) {
    rmSync(temporaryPath, { force: true })
    throw error
  }
}

/**
 * Reads an `mcp.json` (empty when missing), lets `edit` change a copy of its `mcpServers`, and,
 * when `edit` returns true, writes back only what changed.
 */
export function editMcpServers(filePath: string, edit: (servers: JsonRecord) => boolean) {
  const text = existsSync(filePath) ? readFileSync(filePath, 'utf8') : undefined
  const parsed = parseFile(filePath, text)
  const before = isJsonRecord(parsed.mcpServers) ? parsed.mcpServers : undefined
  const servers: JsonRecord = before ? structuredClone(before) : {}
  if (!edit(servers)) return false
  writeAtomically(filePath, editedText(text ?? '', before, servers))
  return true
}
