import type {
  McpAddServerInput,
  McpImportApplyInput,
  McpImportApplyResult,
  McpImportPreviewInput,
  McpRemoveServerInput,
  McpServerDefinition,
} from '@shared/types/mcp'
import { validateMcpServerDefinition } from '../../domain/mcp/server-policy'
import type { McpConfigContextStore } from './config-context-store'
import { normalizeProjectPath, serverByInstanceId, withoutServerState } from './config-view'
import { previewMcpImports } from './import-adapters'
import { writeJsonFileAtomic } from './json-files'
import { getMcpSourceDefinition } from './source-definitions'

type TargetConfig = Awaited<ReturnType<McpConfigMutations['loadTargetConfigUnlocked']>>
const FIRST_RENAME_SUFFIX = 2

export class McpConfigMutations {
  constructor(private readonly store: McpConfigContextStore) {}

  async removeServer(input: McpRemoveServerInput) {
    return this.store.runSerialized(async () => {
      const context = await this.store.loadContextUnlocked(input)
      const server = serverByInstanceId(context, input.instanceId)
      const servers = { ...(server.source.config.mcpServers ?? server.source.config.servers ?? {}) }
      delete servers[server.name]
      const { servers: ignoredNativeServers, ...withoutNativeServers } = server.source.config
      void ignoredNativeServers
      await writeJsonFileAtomic(server.source.definition.path, {
        ...withoutNativeServers,
        mcpServers: servers,
      })
      await this.store.persistStateUnlocked(withoutServerState(context.state, server.identityKey))
      return this.store.getViewUnlocked(input)
    })
  }

  async loadTargetConfigUnlocked(target: 'global' | 'project', projectPath?: string | null) {
    const normalizedProjectPath = normalizeProjectPath(projectPath)
    if (target === 'project' && !normalizedProjectPath) {
      throw new Error('A project path is required for project MCP configuration.')
    }
    const sourceId = target === 'global' ? 'global-openwaggle' : 'project-openwaggle'
    const definition = getMcpSourceDefinition(this.store.options, sourceId, normalizedProjectPath)
    const context = await this.store.loadContextUnlocked({ projectPath: normalizedProjectPath })
    const source = context.sources.find((candidate) => candidate.definition.id === definition.id)
    if (!source) throw new Error(`MCP target source ${definition.label} is unavailable.`)
    return { normalizedProjectPath, definition, config: source.config }
  }

  private async writeTargetServers(
    target: TargetConfig,
    servers: Readonly<Record<string, McpServerDefinition>>,
  ) {
    const { servers: ignoredNativeServers, ...withoutNativeServers } = target.config
    void ignoredNativeServers
    await writeJsonFileAtomic(target.definition.path, {
      ...withoutNativeServers,
      mcpServers: servers,
    })
  }

  async addServer(input: McpAddServerInput) {
    return this.store.runSerialized(async () => {
      const name = input.name.trim()
      if (!name) throw new Error('MCP server name cannot be empty.')
      const target = await this.loadTargetConfigUnlocked(input.target, input.projectPath)
      const issues = validateMcpServerDefinition({
        definition: input.definition,
        sourceScope: target.definition.scope,
      })
      if (issues.length > 0) throw new Error(`Cannot add ${name}: ${issues.join(' ')}`)
      const existing = target.config.mcpServers ?? target.config.servers ?? {}
      if (existing[name] && input.replace !== true) {
        throw new Error(`MCP server "${name}" already exists in ${target.definition.label}.`)
      }
      await this.writeTargetServers(target, {
        ...existing,
        [name]: {
          ...input.definition,
          provenance: input.definition.provenance ?? {
            source: 'manual',
            importedAt: new Date().toISOString(),
          },
        },
      })
      return this.store.getViewUnlocked({
        projectPath: target.normalizedProjectPath,
        sessionId: input.sessionId,
      })
    })
  }

  previewImports(input: McpImportPreviewInput) {
    return previewMcpImports({
      homeDir: this.store.options.homeDir,
      projectPath: normalizeProjectPath(input.projectPath),
      ...(input.sources ? { sources: input.sources } : {}),
    })
  }

  private renamedImportName(name: string, servers: Readonly<Record<string, unknown>>) {
    if (!servers[name]) return name
    let suffix = FIRST_RENAME_SUFFIX
    while (servers[`${name}-${String(suffix)}`]) suffix += 1
    return `${name}-${String(suffix)}`
  }

  private selectImportName(input: {
    readonly candidate: McpImportApplyResult['imported'][number] & { readonly fingerprint: string }
    readonly servers: Readonly<Record<string, unknown>>
    readonly conflictPolicy: McpImportApplyInput['conflictPolicy']
  }) {
    if (!input.servers[input.candidate.sourceName]) return input.candidate.sourceName
    if (input.conflictPolicy === 'rename') {
      return this.renamedImportName(input.candidate.sourceName, input.servers)
    }
    return input.conflictPolicy === 'replace' ? input.candidate.sourceName : null
  }

  async applyImports(input: McpImportApplyInput): Promise<McpImportApplyResult> {
    const preview = await this.previewImports(input)
    const requestedFingerprints = new Set(input.fingerprints)
    const selected: (typeof preview.candidates)[number][] = []
    const selectedFingerprints = new Set<string>()
    for (const candidate of preview.candidates) {
      if (!requestedFingerprints.has(candidate.fingerprint)) continue
      selected.push(candidate)
      selectedFingerprints.add(candidate.fingerprint)
    }
    const skipped: McpImportApplyResult['skipped'][number][] = []
    for (const fingerprint of input.fingerprints) {
      if (!selectedFingerprints.has(fingerprint)) {
        skipped.push({
          fingerprint,
          reason: 'The source changed or disappeared after preview. Preview imports again.',
        })
      }
    }
    const imported: McpImportApplyResult['imported'][number][] = []
    return this.store.runSerialized(async () => {
      const target = await this.loadTargetConfigUnlocked(input.target, input.projectPath)
      const servers = { ...(target.config.mcpServers ?? target.config.servers ?? {}) }
      for (const candidate of selected) {
        const targetName = this.selectImportName({
          candidate: {
            source: candidate.source,
            sourceName: candidate.name,
            targetName: candidate.name,
            fingerprint: candidate.fingerprint,
          },
          servers,
          conflictPolicy: input.conflictPolicy,
        })
        const failure = importFailure(candidate, targetName, target.definition.scope)
        if (failure) {
          skipped.push({ fingerprint: candidate.fingerprint, reason: failure })
          continue
        }
        if (!targetName) continue
        servers[targetName] = {
          ...candidate.definition,
          provenance: {
            source: candidate.source,
            sourcePath: candidate.sourcePath,
            fingerprint: candidate.fingerprint,
            importedAt: new Date().toISOString(),
          },
        }
        imported.push({
          source: candidate.source,
          sourceName: candidate.name,
          targetName,
          fingerprint: candidate.fingerprint,
        })
      }
      if (imported.length > 0) await this.writeTargetServers(target, servers)
      return {
        imported,
        skipped,
        view: await this.store.getViewUnlocked({ projectPath: target.normalizedProjectPath }),
      }
    })
  }
}

function importFailure(
  candidate: Awaited<ReturnType<typeof previewMcpImports>>['candidates'][number],
  targetName: string | null,
  sourceScope: 'global' | 'project',
) {
  if (!candidate.definition.command && !candidate.definition.url)
    return candidate.warnings.join(' ')
  if (!targetName)
    return `A server named ${candidate.name} already exists in the target configuration.`
  const issues = validateMcpServerDefinition({ definition: candidate.definition, sourceScope })
  return issues.length > 0 ? issues.join(' ') : null
}
