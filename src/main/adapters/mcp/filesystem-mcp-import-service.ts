import type {
  McpImportApplyRequest,
  McpImportCandidateView,
  McpImportPreviewRequest,
  McpImportPreviewView,
} from '@shared/types/mcp-configuration-operations'
import { isRecord } from '@shared/utils/validation'
import { Cause, Effect, Exit } from 'effect'
import { McpConfigurationError } from '../../ports/mcp-configuration-service'
import type { McpImportEntryWriter, McpImportServiceShape } from '../../ports/mcp-import-service'
import {
  type McpConfigFileReader,
  type McpConfigFileRoots,
  mcpConfigFileLocations,
  nodeMcpConfigFileReader,
  openWaggleMcpConfigPath,
  PROJECT_FILE_IS_GLOBAL,
} from './config/mcp-config-files'
import { loadMcpMergedConfig } from './config/mcp-runtime-config'
import { applyMcpImports } from './import/import-apply'
import { type McpImportTargetServers, previewMcpImports } from './import/import-preview'
import type { ExternalMcpImportCandidate, ExternalMcpImportPreview } from './import/import-types'

export interface FilesystemMcpImportServiceOptions {
  readonly homeDir: string
  readonly piAgentDir: string
  readonly reader?: McpConfigFileReader
  /** Reads another tool's file; the default reads the disk. */
  readonly readSourceText?: (filePath: string) => Promise<string | undefined>
  readonly platform?: NodeJS.Platform
  readonly now?: () => Date
}

function describe(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function toConfigurationError(error: unknown) {
  return error instanceof McpConfigurationError
    ? error
    : new McpConfigurationError({ reason: 'io', message: describe(error) })
}

function serversIn(
  reader: McpConfigFileReader,
  filePath: string,
): Readonly<Record<string, unknown>> {
  const text = reader.readText(filePath)
  if (!text?.trim()) return {}
  const parsed: unknown = JSON.parse(text)
  return isRecord(parsed) && isRecord(parsed.mcpServers) ? parsed.mcpServers : {}
}

/** Servers already in OpenWaggle's files, so earlier imports and taken names are recognised. */
function targetServers(
  reader: McpConfigFileReader,
  roots: McpConfigFileRoots,
): McpImportTargetServers {
  return {
    global: serversIn(reader, openWaggleMcpConfigPath(roots, 'global')),
    ...(roots.projectPath
      ? { project: serversIn(reader, openWaggleMcpConfigPath(roots, 'project')) }
      : {}),
  }
}

function displayTarget(entry: Readonly<Record<string, unknown>>) {
  if (typeof entry.url === 'string') return entry.url
  const args = Array.isArray(entry.args)
    ? entry.args.filter((arg): arg is string => typeof arg === 'string')
    : []
  return typeof entry.command === 'string' ? [entry.command, ...args].join(' ') : ''
}

function candidateView(candidate: ExternalMcpImportCandidate): McpImportCandidateView {
  return {
    source: candidate.source,
    sourcePath: candidate.sourcePath,
    suggestedTarget: candidate.suggestedTarget,
    name: candidate.name,
    targetName: candidate.targetName,
    target: displayTarget(candidate.entry),
    fingerprint: candidate.fingerprint,
    warnings: candidate.warnings,
    status: candidate.status,
  }
}

function previewView(preview: ExternalMcpImportPreview): McpImportPreviewView {
  return {
    candidates: preview.candidates.map(candidateView),
    unavailableSources: preview.unavailableSources,
    errors: preview.errors,
  }
}

export function createFilesystemMcpImportService(
  options: FilesystemMcpImportServiceOptions,
): McpImportServiceShape {
  const reader = options.reader ?? nodeMcpConfigFileReader
  const roots = (projectPath: string | null): McpConfigFileRoots => ({
    homeDir: options.homeDir,
    piAgentDir: options.piAgentDir,
    projectPath,
  })
  const preview = (input: McpImportPreviewRequest) =>
    previewMcpImports({
      homeDir: options.homeDir,
      projectPath: input.projectPath,
      ...(options.platform ? { platform: options.platform } : {}),
      ...(input.sources ? { sources: input.sources } : {}),
      ...(options.readSourceText ? { readText: options.readSourceText } : {}),
      targetServers: targetServers(reader, roots(input.projectPath)),
    })

  const apply = async (input: McpImportApplyRequest, write: McpImportEntryWriter) => {
    if (input.target === 'project' && !input.projectPath) {
      throw new McpConfigurationError({
        reason: 'validation',
        message: 'Choose a project to import servers into it.',
      })
    }
    // A project at the home folder, or whose .openwaggle links to the global folder, has no file
    // of its own: its .openwaggle/mcp.json is the global one.
    const hasProjectFile = mcpConfigFileLocations(roots(input.projectPath)).some(
      (file) => file.fileId === 'project-openwaggle',
    )
    if (input.target === 'project' && !hasProjectFile) {
      throw new McpConfigurationError({
        reason: 'validation',
        message: `${PROJECT_FILE_IS_GLOBAL} Import for all projects instead: choose All projects in Settings, or leave out -l and --project in the CLI.`,
      })
    }
    const current = await preview(input)
    return applyMcpImports({
      preview: current,
      fingerprints: input.fingerprints,
      target: input.target,
      targetServers: targetServers(reader, roots(input.projectPath))[input.target] ?? {},
      otherServerNames: loadMcpMergedConfig(roots(input.projectPath), reader).servers.map(
        (server) => server.name,
      ),
      conflictPolicy: input.conflictPolicy,
      now: options.now ?? (() => new Date()),
      write: async (target, writes) => {
        const exit = await Effect.runPromiseExit(write(target, writes))
        if (Exit.isFailure(exit)) throw Cause.squash(exit.cause)
      },
    })
  }

  return {
    preview: (input) =>
      Effect.tryPromise({ try: () => preview(input), catch: toConfigurationError }).pipe(
        Effect.map(previewView),
      ),
    apply: (input, write) =>
      Effect.tryPromise({ try: () => apply(input, write), catch: toConfigurationError }),
  }
}
