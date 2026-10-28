import { fromPartial } from '@total-typescript/shoehorn'
import { expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  createSession: vi.fn(async () => ({ session: { setThinkingLevel: vi.fn() } })),
  desktopShellReady: Promise.resolve(),
}))

vi.mock('@earendil-works/pi-coding-agent', () => ({
  createBashToolDefinition: () => ({ name: 'bash' }),
  createPowerShellToolDefinition: () => ({ name: 'powershell' }),
  defineTool: (definition: unknown) => definition,
}))
vi.mock('../powershell-availability', () => ({ offersPowerShellTool: () => false }))
vi.mock('../../pi-session-lifecycle', () => ({
  createOpenWaggleAgentSessionFromServices: mocks.createSession,
}))
vi.mock('../../../../env', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../env')>()),
  desktopShellEnvironmentReady: () => mocks.desktopShellReady,
}))

import { createPiSessionForRun } from '../pi-run-session'

it("starts a Run's Pi session only once the Host has the user's login-shell environment", async () => {
  const ready = Promise.withResolvers<void>()
  mocks.desktopShellReady = ready.promise
  const created = createPiSessionForRun(
    fromPartial({
      projectRoot: '/project',
      workspacePath: '/workspace',
      services: { cwd: '/workspace' },
      sessionManager: { buildSessionContext: () => ({ messages: [] }) },
    }),
  )
  await new Promise((resolve) => setImmediate(resolve))

  // Its bash and PowerShell tools spawn from this process's PATH, SSH agent and locale.
  expect(mocks.createSession).not.toHaveBeenCalled()
  ready.resolve()
  await created
  expect(mocks.createSession).toHaveBeenCalledOnce()
})
