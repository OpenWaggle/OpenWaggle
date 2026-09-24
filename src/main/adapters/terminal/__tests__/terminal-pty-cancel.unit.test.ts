import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import {
  integrationCleanupMock,
  makeRunner,
  prepareTerminalShellLaunchMock,
  resetPtyRunnerHarness,
  SPAWN_REQUEST,
  spawnMock,
} from './terminal-pty-runner-test-harness'

beforeEach(resetPtyRunnerHarness)
afterEach(() => vi.restoreAllMocks())

it('does not spawn after an action launch is canceled during preparation', async () => {
  const controller = new AbortController()
  const prepared = Promise.withResolvers<void>()
  const resume = Promise.withResolvers<void>()
  prepareTerminalShellLaunchMock.mockImplementationOnce(async (candidate, environment) => {
    prepared.resolve()
    await resume.promise
    return {
      args: candidate.args,
      environment: { ...environment },
      integrated: true,
      cleanup: integrationCleanupMock,
    }
  })
  const outcome = makeRunner().spawn({ ...SPAWN_REQUEST, signal: controller.signal })
  await prepared.promise
  controller.abort()
  resume.resolve()
  await expect(outcome).resolves.toMatchObject({
    ok: false,
    error: expect.objectContaining({ message: 'Action launch canceled.' }),
  })
  expect(spawnMock).not.toHaveBeenCalled()
  expect(integrationCleanupMock).toHaveBeenCalledOnce()
})
