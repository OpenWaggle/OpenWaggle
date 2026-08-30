import fs from 'node:fs/promises'
import { decodeUnknownExactOrThrow } from '@shared/schema'
import { agentDefinitionManagementCommandSchema } from '@shared/schemas/agent-definition-management'
import type { AgentDefinitionManagementCommand } from '@shared/types/agent-definition-management'

const selectedSourcesBySender = new Map<number, Set<string>>()

async function canonicalExistingPath(candidate: string, label: string) {
  try {
    return await fs.realpath(candidate)
  } catch {
    throw new Error(`${label} is not an existing filesystem path.`)
  }
}

export async function rememberAgentDefinitionImportSource(senderId: number, sourcePath: string) {
  const canonical = await canonicalExistingPath(sourcePath, 'Selected import source')
  const sources = selectedSourcesBySender.get(senderId) ?? new Set<string>()
  sources.add(canonical)
  selectedSourcesBySender.set(senderId, sources)
  return canonical
}

export function forgetAgentDefinitionImportSources(senderId: number) {
  selectedSourcesBySender.delete(senderId)
}

export async function authorizeAgentDefinitionIpcCommand(input: {
  readonly senderId: number
  readonly command: unknown
  readonly knownProjectPaths: readonly string[]
  readonly resolveRefreshSourcePath?: (
    projectPath: string,
    name: string,
  ) => Promise<string | undefined>
}): Promise<AgentDefinitionManagementCommand> {
  const command = decodeUnknownExactOrThrow(agentDefinitionManagementCommandSchema, input.command)
  const canonicalProjectPath = await canonicalExistingPath(command.projectPath, 'Agent project')
  const canonicalKnownProjects = await Promise.all(
    input.knownProjectPaths.map(async (candidate) => {
      try {
        return await fs.realpath(candidate)
      } catch {
        return null
      }
    }),
  )
  if (!canonicalKnownProjects.includes(canonicalProjectPath)) {
    throw new Error('Agent definitions may only be managed for an OpenWaggle project.')
  }

  if (command.operation === 'write' && command.document.import) {
    throw new Error('Import provenance is managed by OpenWaggle and cannot be written by the UI.')
  }
  if (command.operation === 'refresh-plan' || command.operation === 'refresh-apply') {
    const sourcePath = await input.resolveRefreshSourcePath?.(canonicalProjectPath, command.name)
    if (!sourcePath) {
      throw new Error('This Agent definition has no refreshable import source.')
    }
    const canonicalSourcePath = await canonicalExistingPath(sourcePath, 'Import source')
    if (!selectedSourcesBySender.get(input.senderId)?.has(canonicalSourcePath)) {
      throw new Error('Select this Agent definition source in OpenWaggle before refreshing it.')
    }
    return { ...command, projectPath: canonicalProjectPath }
  }
  if (command.operation !== 'import-plan' && command.operation !== 'import-apply') {
    return { ...command, projectPath: canonicalProjectPath }
  }

  const canonicalSourcePath = await canonicalExistingPath(command.sourcePath, 'Import source')
  if (!selectedSourcesBySender.get(input.senderId)?.has(canonicalSourcePath)) {
    throw new Error('Select this Agent definition source in OpenWaggle before importing it.')
  }
  return {
    ...command,
    projectPath: canonicalProjectPath,
    sourcePath: canonicalSourcePath,
  }
}
