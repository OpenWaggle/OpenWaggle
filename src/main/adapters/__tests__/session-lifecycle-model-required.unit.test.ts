import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { SessionId, SupportedModelId, WorkspaceId } from '@shared/types/brand'
import type { SessionLifecycleCommand } from '@shared/types/session-lifecycle'
import * as Cause from 'effect/Cause'
import * as Effect from 'effect/Effect'
import * as Exit from 'effect/Exit'
import * as Option from 'effect/Option'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SessionLifecyclePreparationService } from '../../ports/session-lifecycle-preparation-service'
import { makeLifecyclePreparationLayer } from './session-lifecycle-preparation-test-support'

function prepare(filename: string, command: SessionLifecycleCommand, createdProjects: string[]) {
  return Effect.runPromiseExit(
    Effect.gen(function* () {
      const service = yield* SessionLifecyclePreparationService
      return yield* service.prepare({
        callerId: 'local-user',
        identities: {
          sessionId: SessionId('session-root'),
          workspaceId: WorkspaceId('workspace-root'),
        },
        request: {
          contractVersion: 2,
          requestId: 'request',
          idempotencyKey: 'key',
          command,
        },
      })
    }).pipe(
      Effect.provide(
        makeLifecyclePreparationLayer(filename, createdProjects, '/project', {
          selectedModel: SupportedModelId(''),
        }),
      ),
    ),
  )
}

describe('launching without a model', () => {
  let temporaryRoot = ''

  beforeEach(async () => {
    temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-model-required-'))
  })

  afterEach(async () => {
    await fs.rm(temporaryRoot, { recursive: true, force: true })
  })

  it('refuses a launch before creating any Pi session, and says how to pick a model', async () => {
    const createdProjects: string[] = []
    const exit = await prepare(
      path.join(temporaryRoot, 'launch.sqlite'),
      {
        operation: 'launch',
        projectPath: '/project',
        objective: 'Do it.',
        attachmentIds: [],
      },
      createdProjects,
    )

    expect(exit._tag).toBe('Failure')
    const failure = Exit.isFailure(exit) ? Cause.failureOption(exit.cause) : Option.none()
    expect(Option.getOrUndefined(failure)).toMatchObject({
      operation: 'resolve-model',
      cause: new Error(
        'No model is selected. Pass --model <provider/model>, or choose a model in the OpenWaggle desktop app.',
      ),
    })
    expect(createdProjects).toEqual([])
  })

  it('still creates an idle Session, whose model can be chosen before its first Run', async () => {
    const exit = await prepare(
      path.join(temporaryRoot, 'create.sqlite'),
      { operation: 'create', projectPath: '/project' },
      [],
    )

    expect(exit._tag).toBe('Success')
  })
})
