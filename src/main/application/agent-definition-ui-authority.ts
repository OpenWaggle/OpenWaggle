import fs from 'node:fs/promises'
import { decodeUnknownExactOrThrow } from '@shared/schema'
import { agentDefinitionManagementCommandSchema } from '@shared/schemas/agent-definition-management'
import type { AgentDefinitionScope } from '@shared/types/agent-definition'
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

export function listAgentDefinitionImportSources(senderId: number): readonly string[] {
  return [...(selectedSourcesBySender.get(senderId) ?? [])]
}

async function knownProjectsInclude(
  knownProjectPaths: readonly string[],
  canonicalProjectPath: string,
) {
  const canonicalKnownProjects = await Promise.all(
    knownProjectPaths.map(async (candidate) => {
      try {
        return await fs.realpath(candidate)
      } catch {
        return null
      }
    }),
  )
  return canonicalKnownProjects.includes(canonicalProjectPath)
}

interface AgentDefinitionUiCommandInput {
  readonly senderId: number
  readonly command: unknown
  readonly knownProjectPaths: readonly string[]
  readonly isKnownProjectPath?: (requestedPath: string, canonicalPath: string) => Promise<boolean>
  readonly selectedSourcePaths?: readonly string[]
  readonly resolveRefreshSourcePath?: (
    projectPath: string,
    name: string,
    scope?: AgentDefinitionScope,
  ) => Promise<string | undefined>
}

async function assertKnownProject(
  input: AgentDefinitionUiCommandInput,
  requestedPath: string,
  canonicalPath: string,
) {
  if (
    !(await knownProjectsInclude(input.knownProjectPaths, canonicalPath)) &&
    !(await input.isKnownProjectPath?.(requestedPath, canonicalPath))
  ) {
    throw new Error('Agent definitions may only be managed for an OpenWaggle project.')
  }
}

export async function authorizeAgentDefinitionUiCommand(
  input: AgentDefinitionUiCommandInput,
): Promise<AgentDefinitionManagementCommand> {
  const command = decodeUnknownExactOrThrow(agentDefinitionManagementCommandSchema, input.command)
  const canonicalProjectPath = await canonicalExistingPath(command.projectPath, 'Agent project')
  const selectedSourcePaths = input.selectedSourcePaths
    ? new Set(
        await Promise.all(
          input.selectedSourcePaths.map((sourcePath) =>
            canonicalExistingPath(sourcePath, 'Selected import source'),
          ),
        ),
      )
    : selectedSourcesBySender.get(input.senderId)
  await assertKnownProject(input, command.projectPath, canonicalProjectPath)

  if (command.operation === 'write' && command.document.import) {
    throw new Error('Import provenance is managed by OpenWaggle and cannot be written by the UI.')
  }
  if (command.operation === 'refresh-plan' || command.operation === 'refresh-apply') {
    const sourcePath = await input.resolveRefreshSourcePath?.(
      canonicalProjectPath,
      command.name,
      command.scope,
    )
    if (!sourcePath) throw new Error('This Agent definition has no refreshable import source.')
    const canonicalSourcePath = await canonicalExistingPath(sourcePath, 'Import source')
    if (!selectedSourcePaths?.has(canonicalSourcePath)) {
      throw new Error('Select this Agent definition source in OpenWaggle before refreshing it.')
    }
    return { ...command, projectPath: canonicalProjectPath }
  }
  if (command.operation !== 'import-plan' && command.operation !== 'import-apply') {
    return { ...command, projectPath: canonicalProjectPath }
  }

  const canonicalSourcePath = await canonicalExistingPath(command.sourcePath, 'Import source')
  if (!selectedSourcePaths?.has(canonicalSourcePath)) {
    throw new Error('Select this Agent definition source in OpenWaggle before importing it.')
  }
  return { ...command, projectPath: canonicalProjectPath, sourcePath: canonicalSourcePath }
}
