import { readFile } from 'node:fs/promises'
import path from 'node:path'
import type { McpImportCandidate, McpImportPreview, McpImportSource } from '@shared/types/mcp'
import { parse as parseJsonc } from 'jsonc-parser'
import { parse as parseToml } from 'smol-toml'
import { createMcpRevision, hashMcpServerDefinition } from './config-identity'
import { normalizeImportedMcpServer } from './import-normalization'
import {
  ALL_IMPORT_SOURCES,
  getMcpImportPaths,
  type ImportOptions,
  type ImportPath,
} from './import-paths'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

async function readImportFile(candidate: ImportPath) {
  try {
    const raw = await readFile(candidate.path, 'utf8')
    const parsed: unknown = candidate.format === 'toml' ? parseToml(raw) : parseJsonc(raw)
    if (!isRecord(parsed)) throw new Error('configuration root must be an object')
    return parsed
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(
      `Cannot import ${candidate.source} MCP config at ${candidate.path}: ${message}`,
      {
        cause: error,
      },
    )
  }
}

function serverMapAt(value: unknown, key: string) {
  if (!isRecord(value)) return {}
  const candidate = value[key]
  return isRecord(candidate) ? candidate : {}
}

function looksLikeServerDefinition(value: unknown) {
  return isRecord(value) && ('command' in value || 'url' in value)
}

function rootServerMap(value: Record<string, unknown>) {
  const entries = Object.entries(value).filter(([, definition]) =>
    looksLikeServerDefinition(definition),
  )
  return Object.fromEntries(entries)
}

function legacyDisabledServerMap(parsed: Record<string, unknown>) {
  const openWaggle = parsed.openwaggle
  return serverMapAt(openWaggle, 'disabledMcpServers')
}

function markDisabledServers(servers: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(servers).map(([name, definition]) => [
      name,
      isRecord(definition) ? { ...definition, disabled: true } : definition,
    ]),
  )
}

function extractServerMap(
  importPath: ImportPath,
  parsed: Record<string, unknown>,
  projectPath?: string | null,
) {
  const source = importPath.source
  if (source === 'codex') return serverMapAt(parsed, 'mcp_servers')
  if (source === 'opencode') return serverMapAt(parsed, 'mcp')
  if (source === 'vscode') return serverMapAt(parsed, 'servers')
  if (source === 'zed') return serverMapAt(parsed, 'context_servers')
  if (source === 'claude-code') {
    const globalServers = serverMapAt(parsed, 'mcpServers')
    if (!projectPath) return globalServers
    const projects = serverMapAt(parsed, 'projects')
    const project = projects[path.resolve(projectPath)]
    return { ...globalServers, ...serverMapAt(project, 'mcpServers') }
  }
  const named = serverMapAt(parsed, 'mcpServers')
  const legacyNamed = serverMapAt(parsed, 'mcp-servers')
  const active =
    Object.keys(named).length > 0
      ? named
      : Object.keys(legacyNamed).length > 0
        ? legacyNamed
        : rootServerMap(parsed)
  if (source !== 'pi') return active
  const disabled = markDisabledServers(legacyDisabledServerMap(parsed))
  return importPath.selection === 'legacy-disabled-only' ? disabled : { ...active, ...disabled }
}

export async function previewMcpImports(options: ImportOptions): Promise<McpImportPreview> {
  const selectedSources = options.sources ?? ALL_IMPORT_SOURCES
  const candidates: McpImportCandidate[] = []
  const foundSources = new Set<McpImportSource>()

  const loadedImports = await Promise.all(
    getMcpImportPaths(options).map(async (importPath) => ({
      importPath,
      parsed: await readImportFile(importPath),
    })),
  )
  for (const { importPath, parsed } of loadedImports) {
    if (!parsed) continue
    foundSources.add(importPath.source)
    const serverMap = extractServerMap(importPath, parsed, options.projectPath)
    for (const [name, value] of Object.entries(serverMap)) {
      const normalized = normalizeImportedMcpServer(importPath.source, name, value)
      if (!normalized) continue
      const definitionHash = hashMcpServerDefinition(normalized.definition)
      candidates.push({
        source: importPath.source,
        sourcePath: importPath.path,
        suggestedTarget: importPath.suggestedTarget,
        name,
        definition: normalized.definition,
        fingerprint: createMcpRevision([importPath.source, importPath.path, name, definitionHash]),
        warnings: normalized.warnings,
      })
    }
  }

  const deduplicated = new Map<string, McpImportCandidate>()
  for (const candidate of candidates) deduplicated.set(candidate.fingerprint, candidate)
  return {
    candidates: [...deduplicated.values()].sort((left, right) =>
      `${left.source}:${left.name}`.localeCompare(`${right.source}:${right.name}`),
    ),
    unavailableSources: selectedSources.filter((source) => !foundSources.has(source)),
  }
}

export { ALL_IMPORT_SOURCES }
