import { SessionId, SupportedModelId } from '@shared/types/brand'
import type { SessionDetail } from '@shared/types/session'
import { fromPartial } from '@total-typescript/shoehorn'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { isSessionModelRunnable } from '../../../application/session-model-availability'
import { ExtensionLifecycleRepository } from '../../../ports/extension-lifecycle-repository'
import { ExtensionManagerService } from '../../../ports/extension-manager-service'
import { ExtensionProjectOverridesRepository } from '../../../ports/extension-project-overrides-repository'
import { temporaryTestDirectory } from '../../../test-support/temporary-test-directory'
import { withPiSession } from '../agent-kernel/session-runtime'
import { createPiProjectModelRuntime } from '../pi-provider-catalog'
import { ProviderServiceLive } from '../pi-provider-service'
import { writeProviderExtension } from './pi-provider-catalog.test-utils'

/**
 * A Session whose virtual model's extension was removed keeps working on the real model that
 * answered last, as Pi does when it resumes such a session.
 */
const PHYSICAL_MODEL = 'fallback-provider/offline-model'
const REMOVED_VIRTUAL_MODEL = SupportedModelId('router/auto')

async function projectWithPhysicalModel() {
  vi.stubEnv('PI_CODING_AGENT_DIR', await temporaryTestDirectory('openwaggle-pi-agent-'))
  const projectPath = await temporaryTestDirectory('openwaggle-virtual-fallback-')
  await writeProviderExtension(projectPath, 'fallback-provider')
  return projectPath
}

function sessionAnsweredBy(projectPath: string, model: string | undefined) {
  return fromPartial<SessionDetail>({
    id: SessionId('virtual-fallback-session'),
    projectPath,
    messages: model
      ? [
          { id: 'user-1', role: 'user', parts: [], createdAt: 1 },
          { id: 'assistant-1', role: 'assistant', parts: [], model, createdAt: 2 },
        ]
      : [],
  })
}

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('a Session whose virtual model is gone', () => {
  it('uses the real model that answered last', async () => {
    const projectPath = await projectWithPhysicalModel()

    const model = await withPiSession(
      { session: sessionAnsweredBy(projectPath, PHYSICAL_MODEL), model: REMOVED_VIRTUAL_MODEL },
      (session) => `${session.model?.provider}/${session.model?.id}`,
    )

    expect(model).toBe(PHYSICAL_MODEL)
  })

  it('still reports the missing model when nothing has answered yet', async () => {
    const projectPath = await projectWithPhysicalModel()

    await expect(
      withPiSession(
        { session: sessionAnsweredBy(projectPath, undefined), model: REMOVED_VIRTUAL_MODEL },
        () => undefined,
      ),
    ).rejects.toThrow('could not resolve model router/auto')
  })

  it("says so in Pi's words", async () => {
    const projectPath = await projectWithPhysicalModel()

    const runtime = await createPiProjectModelRuntime({
      projectPath,
      modelReference: REMOVED_VIRTUAL_MODEL,
      fallbackModelReference: PHYSICAL_MODEL,
    })

    expect(runtime.modelFallbackMessage).toBe(
      `Could not restore model router/auto (model no longer exists). Using ${PHYSICAL_MODEL}.`,
    )
  })
})

describe("the Host after a restart without the virtual model's extension", () => {
  const providerService = ProviderServiceLive.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.succeed(ExtensionManagerService, { listPackages: () => Effect.succeed([]) }),
        Layer.succeed(ExtensionLifecycleRepository, {
          get: () => Effect.succeed(null),
          list: () => Effect.succeed([]),
          upsert: () => Effect.void,
        }),
        Layer.succeed(ExtensionProjectOverridesRepository, {
          get: () => Effect.succeed(null),
          upsert: () => Effect.void,
        }),
      ),
    ),
  )
  const runnable = (session: SessionDetail) =>
    Effect.runPromise(
      isSessionModelRunnable(REMOVED_VIRTUAL_MODEL, session).pipe(Effect.provide(providerService)),
    )

  it('lets the Session run, so its Run falls back to the model that answered last', async () => {
    // The project's catalog no longer has router/auto; only the model that answered remains.
    const projectPath = await projectWithPhysicalModel()

    await expect(runnable(sessionAnsweredBy(projectPath, PHYSICAL_MODEL))).resolves.toBe(true)
  })

  it('still refuses the missing model when nothing has answered yet', async () => {
    const projectPath = await projectWithPhysicalModel()

    await expect(runnable(sessionAnsweredBy(projectPath, undefined))).resolves.toBe(false)
  })

  it('refuses it when the model that answered last is gone too', async () => {
    const projectPath = await projectWithPhysicalModel()

    await expect(runnable(sessionAnsweredBy(projectPath, 'gone-provider/model'))).resolves.toBe(
      false,
    )
  })
})
