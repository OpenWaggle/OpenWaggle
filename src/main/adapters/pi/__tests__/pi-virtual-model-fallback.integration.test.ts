import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { SessionId, SupportedModelId } from '@shared/types/brand'
import type { SessionDetail } from '@shared/types/session'
import { fromPartial } from '@total-typescript/shoehorn'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { withPiSession } from '../agent-kernel/session-runtime'
import { writeProviderExtension } from './pi-provider-catalog.test-utils'

/**
 * A Session whose virtual model's extension was removed keeps working on the real model that
 * answered last, as Pi does when it resumes such a session.
 */
const PHYSICAL_MODEL = 'fallback-provider/offline-model'
const REMOVED_VIRTUAL_MODEL = SupportedModelId('router/auto')

async function projectWithPhysicalModel() {
  vi.stubEnv(
    'PI_CODING_AGENT_DIR',
    await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-pi-agent-')),
  )
  const projectPath = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-virtual-fallback-'))
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
})
