import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { SessionId, SupportedModelId, WorkspaceId } from '@shared/types/brand'
import type {
  SessionLifecycleCommand,
  SessionLifecycleRequest,
} from '@shared/types/session-lifecycle'
import type { Settings } from '@shared/types/settings'
import * as Cause from 'effect/Cause'
import * as Effect from 'effect/Effect'
import * as Exit from 'effect/Exit'
import * as Option from 'effect/Option'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SessionLifecyclePreparationError } from '../../errors'
import { SessionLifecyclePreparationService } from '../../ports/session-lifecycle-preparation-service'
import { makeLifecyclePreparationLayer } from './session-lifecycle-preparation-test-support'

function prepareCommand(command: SessionLifecycleCommand) {
  return {
    contractVersion: 2,
    requestId: 'request',
    idempotencyKey: 'key',
    command,
  } satisfies SessionLifecycleRequest
}

function prepare(
  filename: string,
  projectPath: string,
  command: SessionLifecycleCommand,
  createdProjects: string[],
  settingsOverrides: Partial<Settings>,
) {
  return Effect.runPromiseExit(
    Effect.gen(function* () {
      const service = yield* SessionLifecyclePreparationService
      return yield* service.prepare({
        callerId: 'local-user',
        identities: {
          sessionId: SessionId('session-root'),
          workspaceId: WorkspaceId('workspace-root'),
        },
        request: prepareCommand(command),
      })
    }).pipe(
      Effect.provide(
        makeLifecyclePreparationLayer(filename, createdProjects, projectPath, {
          enabledModels: [],
          ...settingsOverrides,
        }),
      ),
    ),
  )
}

function refusalOf(exit: Exit.Exit<unknown, unknown>) {
  const failure = Exit.isFailure(exit) ? Cause.failureOption(exit.cause) : Option.none()
  const error = Option.getOrUndefined(failure)
  expect(error).toBeInstanceOf(SessionLifecyclePreparationError)
  return error instanceof SessionLifecyclePreparationError ? error : undefined
}

describe('provider restrictions in session lifecycle', () => {
  let temporaryRoot = ''

  beforeEach(async () => {
    temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-provider-restriction-'))
  })

  afterEach(async () => {
    await fs.rm(temporaryRoot, { recursive: true, force: true })
  })

  it('refuses a launch that names a model from a provider the project does not allow', async () => {
    const createdProjects: string[] = []
    const exit = await prepare(
      path.join(temporaryRoot, 'named.sqlite'),
      '/project',
      {
        operation: 'launch',
        projectPath: '/project',
        objective: 'Do it.',
        attachmentIds: [],
        specialization: { modelId: 'openrouter/model' },
      },
      createdProjects,
      { providerRestrictions: { openrouter: false } },
    )

    expect(exit._tag).toBe('Failure')
    const error = refusalOf(exit)
    expect(error).toMatchObject({ operation: 'enforce-provider-restriction' })
    expect(String(error?.cause)).toContain('openrouter')
    expect(createdProjects).toEqual([])
  })

  it('resolves a derived default model again inside the allowed providers', async () => {
    const createdProjects: string[] = []
    const exit = await prepare(
      path.join(temporaryRoot, 'derived.sqlite'),
      '/project',
      { operation: 'launch', projectPath: '/project', objective: 'Do it.', attachmentIds: [] },
      createdProjects,
      {
        selectedModel: SupportedModelId('openrouter/model'),
        enabledModels: [SupportedModelId('openrouter/model'), SupportedModelId('anthropic/claude')],
        providerRestrictions: { openrouter: false },
      },
    )

    expect(exit._tag).toBe('Success')
    const prepared = Exit.isSuccess(exit) ? exit.value : undefined
    expect(prepared).toMatchObject({
      executionSnapshot: { profile: { modelId: 'anthropic/claude' } },
    })
  })

  it('refuses when no enabled model uses a provider the project allows', async () => {
    const createdProjects: string[] = []
    const exit = await prepare(
      path.join(temporaryRoot, 'none.sqlite'),
      '/project',
      { operation: 'launch', projectPath: '/project', objective: 'Do it.', attachmentIds: [] },
      createdProjects,
      {
        selectedModel: SupportedModelId('openrouter/model'),
        enabledModels: [SupportedModelId('openrouter/model')],
        providerRestrictions: { openrouter: false },
      },
    )

    expect(exit._tag).toBe('Failure')
    const error = refusalOf(exit)
    expect(error).toMatchObject({ operation: 'enforce-provider-restriction' })
    expect(String(error?.cause)).toContain('No enabled model')
    expect(createdProjects).toEqual([])
  })

  it('lets the project settings file outrank the app-wide restriction', async () => {
    await fs.mkdir(path.join(temporaryRoot, '.openwaggle'), { recursive: true })
    await fs.writeFile(
      path.join(temporaryRoot, '.openwaggle', 'settings.json'),
      JSON.stringify({ providers: { only: ['anthropic'] } }),
    )
    const createdProjects: string[] = []
    const exit = await prepare(
      path.join(temporaryRoot, 'file.sqlite'),
      temporaryRoot,
      {
        operation: 'launch',
        projectPath: temporaryRoot,
        objective: 'Do it.',
        attachmentIds: [],
        specialization: { modelId: 'anthropic/claude' },
      },
      createdProjects,
      { providerRestrictions: { anthropic: false } },
    )

    expect(exit._tag).toBe('Success')
    expect(createdProjects).toEqual([temporaryRoot])
  })
})
