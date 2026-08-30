import os from 'node:os'
import type { AgentDefinitionDocument, AgentDefinitionScope } from '@shared/types/agent-definition'
import type {
  AgentDefinitionImportPlan,
  AgentDefinitionManagementCommand,
  AgentDefinitionManagementOutcome,
} from '@shared/types/agent-definition-management'
import { listAllAgentDefinitions, resolveAgentDefinition } from './agent-definition-catalog'
import { deleteAgentDefinitionFile, writeAgentDefinitionFile } from './agent-definition-files'
import { planAgentDefinitionImport } from './agent-definition-importer'
import {
  type AgentDefinitionSemanticCatalog,
  formatAgentDefinitionSemanticDiagnostics,
  validateAgentDefinitionSemantics,
} from './agent-definition-semantic-validation'
import { agentDefinitionSemanticDigest } from './agent-definition-serializer'

export type AgentDefinitionSemanticCatalogLoader = (input: {
  readonly projectPath: string
  readonly userHome: string
}) => Promise<AgentDefinitionSemanticCatalog>

export interface AgentDefinitionManagementContext {
  readonly userHome?: string
  readonly now?: number
  readonly loadSemanticCatalog?: AgentDefinitionSemanticCatalogLoader
}

interface ResolvedAgentDefinitionManagementContext {
  readonly userHome: string
  readonly now: number
  readonly loadSemanticCatalog?: AgentDefinitionSemanticCatalogLoader
}

function writeOutcome(
  operation: Extract<AgentDefinitionManagementOutcome['operation'], 'write' | 'duplicate'>,
  result: Awaited<ReturnType<typeof writeAgentDefinitionFile>>,
): AgentDefinitionManagementOutcome {
  return { operation, ...result }
}

function importPlanInput(
  command: Extract<AgentDefinitionManagementCommand, { operation: 'import-plan' | 'import-apply' }>,
  context: ResolvedAgentDefinitionManagementContext,
  semanticCatalog?: AgentDefinitionSemanticCatalog,
) {
  return {
    projectPath: command.projectPath,
    userHome: context.userHome,
    sourcePath: command.sourcePath,
    ...(command.sourceTool ? { sourceTool: command.sourceTool } : {}),
    ...(command.sourceName ? { sourceName: command.sourceName } : {}),
    targetScope: command.targetScope,
    now: context.now,
    ...(semanticCatalog ? { semanticCatalog } : {}),
  }
}

async function semanticCatalog(
  projectPath: string,
  context: ResolvedAgentDefinitionManagementContext,
) {
  return context.loadSemanticCatalog?.({ projectPath, userHome: context.userHome })
}

function assertSemanticValidity(
  document: AgentDefinitionDocument,
  catalog: AgentDefinitionSemanticCatalog | undefined,
) {
  if (!catalog) return
  const validation = validateAgentDefinitionSemantics(document, catalog)
  if (!validation.valid) {
    throw new Error(formatAgentDefinitionSemanticDiagnostics(validation).join(' '))
  }
}

async function writeImport(input: {
  readonly command: Extract<AgentDefinitionManagementCommand, { operation: 'import-apply' }>
  readonly plan: AgentDefinitionImportPlan
  readonly userHome: string
}) {
  if (input.plan.sourceDigest !== input.command.expectedSourceDigest) {
    throw new Error('Import source changed since the plan was reviewed.')
  }
  if (!input.plan.document || input.plan.status === 'blocked') {
    throw new Error(input.plan.diagnostics.join(' ') || 'Agent import plan is blocked.')
  }
  const written = await writeAgentDefinitionFile({
    projectPath: input.command.projectPath,
    userHome: input.userHome,
    scope: input.command.targetScope,
    document: input.plan.document,
    replaceExisting: input.command.replaceExisting === true,
    ...(input.command.expectedContentDigest
      ? { expectedContentDigest: input.command.expectedContentDigest }
      : {}),
  })
  return { operation: 'import-apply', ...written } satisfies AgentDefinitionManagementOutcome
}

function semanticDocument(
  definition: AgentDefinitionDocument & {
    readonly scope?: AgentDefinitionScope
    readonly sourcePath?: string
    readonly contentDigest?: string
  },
) {
  const {
    import: _provenance,
    scope: _scope,
    sourcePath: _sourcePath,
    contentDigest: _contentDigest,
    ...semantic
  } = definition
  return semantic
}

async function refreshPlan(input: {
  readonly projectPath: string
  readonly name: string
  readonly userHome: string
  readonly now: number
  readonly semanticCatalog?: AgentDefinitionSemanticCatalog
}) {
  const current = await resolveAgentDefinition(input)
  if (!current.import) {
    throw new Error(`Agent definition ${JSON.stringify(input.name)} has no import provenance.`)
  }
  const plan = await planAgentDefinitionImport({
    projectPath: input.projectPath,
    userHome: input.userHome,
    sourcePath: current.import.sourcePath,
    sourceTool: current.import.sourceTool,
    targetScope: current.scope,
    now: input.now,
    ...(input.semanticCatalog ? { semanticCatalog: input.semanticCatalog } : {}),
  })
  const modified =
    agentDefinitionSemanticDigest(semanticDocument(current)) !== current.import.baselineDigest
  return {
    ...plan,
    status: modified ? ('conflict' as const) : plan.status === 'blocked' ? 'blocked' : 'ready',
    diagnostics: modified
      ? [...plan.diagnostics, 'The imported Agent definition was modified locally.']
      : plan.diagnostics,
  } satisfies AgentDefinitionImportPlan
}

async function applyRefresh(input: {
  readonly command: Extract<AgentDefinitionManagementCommand, { operation: 'refresh-apply' }>
  readonly userHome: string
  readonly now: number
  readonly semanticCatalog?: AgentDefinitionSemanticCatalog
}) {
  const plan = await refreshPlan({
    ...input.command,
    userHome: input.userHome,
    now: input.now,
    ...(input.semanticCatalog ? { semanticCatalog: input.semanticCatalog } : {}),
  })
  if (plan.sourceDigest !== input.command.expectedSourceDigest) {
    throw new Error('Import source changed since the refresh plan was reviewed.')
  }
  if (!plan.document || plan.status === 'blocked') {
    throw new Error(plan.diagnostics.join(' ') || 'Agent refresh plan is blocked.')
  }
  if (plan.status === 'conflict' && !input.command.replaceModified) {
    throw new Error('Agent definition has local changes; explicit replacement is required.')
  }
  const written = await writeAgentDefinitionFile({
    projectPath: input.command.projectPath,
    userHome: input.userHome,
    scope: plan.targetScope,
    document: plan.document,
    replaceExisting: true,
    ...(plan.existingContentDigest ? { expectedContentDigest: plan.existingContentDigest } : {}),
  })
  return { operation: 'refresh-apply', ...written } satisfies AgentDefinitionManagementOutcome
}

async function writeAgentDefinition(
  command: Extract<AgentDefinitionManagementCommand, { operation: 'write' }>,
  context: ResolvedAgentDefinitionManagementContext,
) {
  assertSemanticValidity(command.document, await semanticCatalog(command.projectPath, context))
  return writeOutcome(
    command.operation,
    await writeAgentDefinitionFile({
      projectPath: command.projectPath,
      userHome: context.userHome,
      scope: command.scope,
      document: command.document,
      replaceExisting: command.replaceExisting === true,
      ...(command.expectedContentDigest
        ? { expectedContentDigest: command.expectedContentDigest }
        : {}),
    }),
  )
}

export async function executeAgentDefinitionManagement(
  command: AgentDefinitionManagementCommand,
  context: AgentDefinitionManagementContext = {},
): Promise<AgentDefinitionManagementOutcome> {
  const resolved: ResolvedAgentDefinitionManagementContext = {
    userHome: context.userHome ?? os.homedir(),
    now: context.now ?? Date.now(),
    ...(context.loadSemanticCatalog ? { loadSemanticCatalog: context.loadSemanticCatalog } : {}),
  }
  if (command.operation === 'list') {
    return {
      operation: command.operation,
      items: await listAllAgentDefinitions({
        projectPath: command.projectPath,
        userHome: resolved.userHome,
      }),
    }
  }
  if (command.operation === 'write') {
    return writeAgentDefinition(command, resolved)
  }
  if (command.operation === 'duplicate') {
    const source = await resolveAgentDefinition({
      projectPath: command.projectPath,
      userHome: resolved.userHome,
      name: command.sourceName,
    })
    const {
      scope: _scope,
      sourcePath: _sourcePath,
      contentDigest: _digest,
      import: _import,
      ...copy
    } = source
    const document = { ...copy, name: command.targetName }
    assertSemanticValidity(document, await semanticCatalog(command.projectPath, resolved))
    return writeOutcome(
      command.operation,
      await writeAgentDefinitionFile({
        projectPath: command.projectPath,
        userHome: resolved.userHome,
        scope: command.targetScope,
        document,
        replaceExisting: false,
      }),
    )
  }
  if (command.operation === 'delete') {
    return {
      operation: command.operation,
      ...(await deleteAgentDefinitionFile({
        projectPath: command.projectPath,
        userHome: resolved.userHome,
        scope: command.scope,
        name: command.name,
        ...(command.expectedContentDigest
          ? { expectedContentDigest: command.expectedContentDigest }
          : {}),
      })),
    }
  }
  if (command.operation === 'import-plan') {
    const catalog = await semanticCatalog(command.projectPath, resolved)
    return {
      operation: command.operation,
      plan: await planAgentDefinitionImport(importPlanInput(command, resolved, catalog)),
    }
  }
  if (command.operation === 'import-apply') {
    const catalog = await semanticCatalog(command.projectPath, resolved)
    return writeImport({
      command,
      plan: await planAgentDefinitionImport(importPlanInput(command, resolved, catalog)),
      userHome: resolved.userHome,
    })
  }
  if (command.operation === 'refresh-plan') {
    const catalog = await semanticCatalog(command.projectPath, resolved)
    return {
      operation: command.operation,
      plan: await refreshPlan({
        ...command,
        ...resolved,
        ...(catalog ? { semanticCatalog: catalog } : {}),
      }),
    }
  }
  const catalog = await semanticCatalog(command.projectPath, resolved)
  return applyRefresh({
    command,
    ...resolved,
    ...(catalog ? { semanticCatalog: catalog } : {}),
  })
}
