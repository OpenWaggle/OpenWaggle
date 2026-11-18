import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fromPartial } from '@total-typescript/shoehorn'
import { afterEach, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ createSession: vi.fn() }))

vi.mock('@earendil-works/pi-coding-agent', () => ({
  createBashToolDefinition: () => ({ name: 'bash' }),
  createPowerShellToolDefinition: () => ({ name: 'powershell' }),
  defineTool: (definition: unknown) => definition,
}))
vi.mock('../../../../utils/session-evidence-directory', () => ({
  SESSION_EVIDENCE_DIRECTORY_ENV: 'OPENWAGGLE_EVIDENCE_DIR',
  preparedSessionEvidenceDirectory: () => '/private/evidence/session-a',
}))
vi.mock('../../pi-session-lifecycle', () => ({
  createOpenWaggleAgentSessionFromServices: mocks.createSession,
}))

const { createPiSessionForRun } = await import('../pi-run-session')

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

it.skipIf(process.platform === 'win32')(
  'declares no powershell tool outside Windows, even with pwsh on the PATH tools run with',
  async () => {
    const bin = await mkdtemp(path.join(tmpdir(), 'openwaggle-pwsh-'))
    roots.push(bin)
    await writeFile(path.join(bin, 'pwsh'), '#!/bin/sh\n')
    await chmod(path.join(bin, 'pwsh'), 0o755)
    mocks.createSession.mockResolvedValue({ session: { setThinkingLevel: vi.fn() } })

    await createPiSessionForRun(
      fromPartial({
        preparedEnvironment: { PATH: bin },
        projectRoot: '/project',
        workspacePath: '/workspace',
        services: { cwd: '/workspace' },
        sessionManager: { buildSessionContext: () => ({ messages: [] }) },
      }),
    )

    expect(mocks.createSession).toHaveBeenCalledWith(
      expect.objectContaining({ customTools: [{ name: 'bash' }] }),
    )
  },
)
