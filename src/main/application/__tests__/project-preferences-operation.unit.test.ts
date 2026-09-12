import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  grantPending: vi.fn(),
  setPreferences: vi.fn(),
}))

vi.mock('../../config/project-config', () => ({
  setProjectPreferences: mocks.setPreferences,
}))

vi.mock('../../utils/project-path-validation', async () => {
  const EffectModule = await import('effect/Effect')
  return {
    validateProjectPath: (projectPath: string | null) => EffectModule.succeed(projectPath),
  }
})

vi.mock('../agent-loop-authorization-grants', () => ({
  grantPendingAuthorizationsWhereFullAccess: mocks.grantPending,
}))

vi.mock('../agent-authorization-mode', () => ({
  resolveEffectiveAuthorizationMode: vi.fn(),
}))

import * as Effect from 'effect/Effect'
import { setProjectPreferencesOperation } from '../project-preferences-operation'

describe('Host-backed project preferences', () => {
  beforeEach(() => {
    mocks.grantPending.mockReset().mockResolvedValue(undefined)
    mocks.setPreferences.mockReset().mockResolvedValue(undefined)
  })

  it('settles authoritative pending prompts after enabling full access', async () => {
    await Effect.runPromise(
      setProjectPreferencesOperation('/project', { authorizationMode: 'yolo' }),
    )

    expect(mocks.setPreferences).toHaveBeenCalledWith('/project', {
      authorizationMode: 'yolo',
    })
    expect(mocks.grantPending).toHaveBeenCalledOnce()
  })
})
