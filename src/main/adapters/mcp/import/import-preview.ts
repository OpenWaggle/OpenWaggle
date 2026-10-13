/**
 * Preview of servers that can be imported from other tools. Reads their
 * configuration files and writes nothing.
 */
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { isRecord } from '@shared/utils/validation'
import { type ParseError, parse as parseJsonc } from 'jsonc-parser'
import { parse as parseToml } from 'smol-toml'
import { importFingerprint, piServerName, sameServerName } from './import-identity'
import { normalizeImportedEntry } from './import-normalization'
import { getMcpImportPaths, type McpImportPath, type McpImportPathOptions } from './import-paths'
import {
  type ExternalMcpImportCandidate,
  type ExternalMcpImportPreview,
  type ExternalMcpImportSource,
  type ExternalMcpImportSourceError,
  MCP_IMPORT_SOURCES,
  type McpImportStatus,
  type McpImportTarget,
} from './import-types'

export type McpImportTargetServers = Partial<
  Record<McpImportTarget, Readonly<Record<string, unknown>>>
>

export interface PreviewMcpImportsInput extends McpImportPathOptions {
  readonly readText?: (filePath: string) => Promise<string | undefined>
  /** Servers already in the target files, so earlier imports and taken names are recognised. */
  readonly targetServers?: McpImportTargetServers
}

interface SourceServer {
  readonly name: string
  readonly value: unknown
  readonly suggestedTarget: McpImportTarget
}

async function readTextFromDisk(filePath: string) {
  try {
    return await readFile(filePath, 'utf8')
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return undefined
    throw error
  }
}

function parseSourceFile(importPath: McpImportPath, text: string) {
  if (importPath.format === 'toml') return parseToml(text)
  const errors: ParseError[] = []
  const parsed: unknown = parseJsonc(text, errors, { allowTrailingComma: true })
  if (errors.length > 0) throw new Error(`invalid JSON at offset ${String(errors[0]?.offset)}`)
  return parsed
}

type SourceFileRead =
  | { readonly kind: 'missing' }
  | { readonly kind: 'parsed'; readonly value: Record<string, unknown> }
  | { readonly kind: 'error'; readonly message: string }

async function readSourceFile(
  importPath: McpImportPath,
  readText: (filePath: string) => Promise<string | undefined>,
): Promise<SourceFileRead> {
  try {
    const text = await readText(importPath.path)
    if (text === undefined) return { kind: 'missing' }
    const parsed = parseSourceFile(importPath, text)
    if (!isRecord(parsed))
      return { kind: 'error', message: 'the configuration root must be an object' }
    return { kind: 'parsed', value: parsed }
  } catch (error) {
    return { kind: 'error', message: error instanceof Error ? error.message : String(error) }
  }
}

function serverMapAt(value: unknown, key: string) {
  if (!isRecord(value)) return {}
  const candidate = value[key]
  return isRecord(candidate) ? candidate : {}
}

const SERVER_MAP_KEYS: Readonly<Record<ExternalMcpImportSource, string>> = {
  codex: 'mcp_servers',
  'claude-code': 'mcpServers',
  'claude-desktop': 'mcpServers',
  cursor: 'mcpServers',
  vscode: 'servers',
  opencode: 'mcp',
  zed: 'context_servers',
  windsurf: 'mcpServers',
}

function sourceServers(
  importPath: McpImportPath,
  parsed: Record<string, unknown>,
  projectPath: string | undefined,
): SourceServer[] {
  const listed = Object.entries(serverMapAt(parsed, SERVER_MAP_KEYS[importPath.source])).map(
    ([name, value]) => ({ name, value, suggestedTarget: importPath.suggestedTarget }),
  )
  if (importPath.source !== 'claude-code' || !projectPath) return listed
  // The claude-code source keeps per-project servers under projects[<project path>].
  const project = serverMapAt(parsed, 'projects')[projectPath]
  const projectServers = Object.entries(serverMapAt(project, 'mcpServers')).map(
    ([name, value]) => ({ name, value, suggestedTarget: 'project' as const }),
  )
  return [...listed, ...projectServers]
}

function provenanceOf(value: unknown) {
  return isRecord(value) && isRecord(value.provenance) ? value.provenance : undefined
}

export function importStatus(
  candidate: Pick<
    ExternalMcpImportCandidate,
    'source' | 'sourcePath' | 'name' | 'targetName' | 'fingerprint'
  >,
  servers: Readonly<Record<string, unknown>> | undefined,
): McpImportStatus {
  if (!servers) return 'new'
  for (const value of Object.values(servers)) {
    const provenance = provenanceOf(value)
    if (
      provenance?.source === candidate.source &&
      provenance.sourcePath === candidate.sourcePath &&
      provenance.sourceName === candidate.name
    ) {
      return provenance.fingerprint === candidate.fingerprint ? 'imported' : 'source-changed'
    }
  }
  const taken = Object.keys(servers).some((name) => sameServerName(name, candidate.targetName))
  return taken ? 'name-taken' : 'new'
}

function candidateFor(
  importPath: McpImportPath,
  server: SourceServer,
  targetServers: McpImportTargetServers | undefined,
): ExternalMcpImportCandidate | undefined {
  const normalized = normalizeImportedEntry(importPath.source, server.name, server.value)
  if (!normalized) return undefined
  const identity = {
    source: importPath.source,
    sourcePath: importPath.path,
    name: server.name,
    targetName: piServerName(server.name),
    fingerprint: importFingerprint({
      source: importPath.source,
      sourcePath: importPath.path,
      name: server.name,
      entry: normalized.entry,
    }),
  }
  return {
    ...identity,
    suggestedTarget: server.suggestedTarget,
    entry: normalized.entry,
    warnings: normalized.warnings,
    status: importStatus(identity, targetServers?.[server.suggestedTarget]),
  }
}

export async function previewMcpImports(
  input: PreviewMcpImportsInput,
): Promise<ExternalMcpImportPreview> {
  const readText = input.readText ?? readTextFromDisk
  const projectPath = input.projectPath?.trim() ? path.resolve(input.projectPath) : undefined
  const candidates = new Map<string, ExternalMcpImportCandidate>()
  const errors: ExternalMcpImportSourceError[] = []
  const found = new Set<ExternalMcpImportSource>()
  for (const importPath of getMcpImportPaths(input)) {
    const read = await readSourceFile(importPath, readText)
    if (read.kind === 'missing') continue
    if (read.kind === 'error') {
      errors.push({ source: importPath.source, path: importPath.path, message: read.message })
      continue
    }
    const parsed = read.value
    found.add(importPath.source)
    for (const server of sourceServers(importPath, parsed, projectPath)) {
      const candidate = candidateFor(importPath, server, input.targetServers)
      if (candidate) candidates.set(candidate.fingerprint, candidate)
    }
  }
  return {
    candidates: [...candidates.values()].sort((left, right) =>
      `${left.source}:${left.name}`.localeCompare(`${right.source}:${right.name}`),
    ),
    unavailableSources: (input.sources ?? MCP_IMPORT_SOURCES).filter(
      (source) => !found.has(source),
    ),
    errors,
  }
}
