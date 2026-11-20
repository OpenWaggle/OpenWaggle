import type { ResolvedAgentDefinitionSnapshot } from '@shared/types/agent-definition'
import { SupportedModelId } from '@shared/types/brand'
import type { SessionLifecycleCommand } from '@shared/types/session-lifecycle'
import { DEFAULT_SETTINGS } from '@shared/types/settings'
import * as Effect from 'effect/Effect'
import * as Exit from 'effect/Exit'
import type * as SqlClient from '@effect/sql/SqlClient'
import { fromPartial } from '@total-typescript/shoehorn'
import { describe, expect, it } from 'vitest'
import type { AgentKernelServiceShape } from '../../ports/agent-kernel-service'
import { prepareForkWhenForking } from '../session-lifecycle-fork-preparation'
import { resolveSessionModels } from '../session-lifecycle-model-enforcement'

const settings = {
  ...DEFAULT_SETTINGS,
  selectedModel: SupportedModelId('anthropic/claude'),
  enabledModels: [SupportedModelId('anthropic/claude')],
  providerRestrictions: { 'amazon-bedrock': false },
}

const blockedParent = {
  profile: { modelId: 'amazon-bedrock/claude', thinkingLevel: 'high' as const },
  resolvedAgentSnapshot: undefined,
  authorizationCeiling: 'yolo' as const,
}

const pinningDefinition: ResolvedAgentDefinitionSnapshot = {
  schemaVersion: 1,
  name: 'pinned',
  description: 'Pins a model.',
  model: 'amazon-bedrock/claude',
  instructions: 'Do the task.',
  scope: 'project',
  sourcePath: '/project/.openwaggle/agents/pinned.md',
  contentDigest: 'a'.repeat(64),
}

const delegation = {
  objective: 'Do it.',
  deliverables: [],
  acceptanceCriteria: [],
  dependencies: [],
  resourceReferences: [],
}

function resolve(
  command: SessionLifecycleCommand,
  context: {
    parent?: typeof blockedParent
    definition?: ResolvedAgentDefinitionSnapshot
  },
) {
  return Effect.runPromiseExit(
    resolveSessionModels({
      command,
      parent: context.parent,
      definition: context.definition,
      thinkingLevel: 'medium',
      settings,
      projectPath: '/project',
      projectProviders: undefined,
    }),
  )
}

describe('session models under provider restrictions', () => {
  it("resolves a spawn's inherited parent model again inside the child's providers", async () => {
    const exit = await resolve(
      {
        operation: 'spawn',
        parentSessionId: 'session-parent',
        expectedParentRunId: 'run-parent',
        workspace: { mode: 'share-parent' },
        delegation,
      },
      { parent: blockedParent },
    )

    expect(Exit.isSuccess(exit) ? exit.value.profile.modelId : null).toBe('anthropic/claude')
  })

  it('refuses an Agent definition that names a model from a refused provider', async () => {
    const exit = await resolve(
      { operation: 'launch', projectPath: '/project', objective: 'Do it.', attachmentIds: [] },
      { definition: pinningDefinition },
    )

    expect(Exit.isFailure(exit)).toBe(true)
  })

  it("gives a fork's Pi file a model inside the project's providers", async () => {
    const exit = await resolve(
      {
        operation: 'fork',
        sourceSessionId: 'session-parent',
        position: 'before',
        workspace: { mode: 'share-source' },
      },
      { parent: blockedParent, definition: pinningDefinition },
    )

    expect(Exit.isSuccess(exit) ? exit.value : null).toMatchObject({
      profile: { modelId: 'anthropic/claude' },
      forkModelId: 'anthropic/claude',
    })
  })

  it('fails a fork with no resolved model instead of letting Pi choose its own', async () => {
    const forkSession = () => Effect.die('a fork without a model must not reach Pi')
    const exit = await Effect.runPromiseExit(
      prepareForkWhenForking({
        sql: fromPartial<SqlClient.SqlClient>({}),
        kernel: fromPartial<AgentKernelServiceShape>({ forkSession }),
        command: {
          operation: 'fork',
          sourceSessionId: 'session-parent',
          position: 'before',
          workspace: { mode: 'share-source' },
        },
        callerId: 'local-user',
        forkModelId: undefined,
        attemptId: 'attempt',
        onForkFile: () => undefined,
      }),
    )

    expect(exit).toMatchObject({
      _tag: 'Failure',
      cause: { error: { operation: 'enforce-provider-restriction' } },
    })
  })
})
