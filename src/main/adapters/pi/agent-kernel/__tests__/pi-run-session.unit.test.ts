import { fromPartial } from '@total-typescript/shoehorn'
import { beforeEach, expect, it, vi } from 'vitest'

type SpawnContext = { command: string; cwd: string; env: NodeJS.ProcessEnv }
type SpawnHook = (context: SpawnContext) => SpawnContext
const mocks = vi.hoisted(() => ({
  hooks: new Map<string, SpawnHook>(),
  createSession: vi.fn(),
}))

vi.mock('@earendil-works/pi-coding-agent', () => ({
  createBashToolDefinition: (_cwd: string, options: { spawnHook: SpawnHook }) => {
    mocks.hooks.set('bash', options.spawnHook)
    return { name: 'bash' }
  },
  createPowerShellToolDefinition: (_cwd: string, options: { spawnHook: SpawnHook }) => {
    mocks.hooks.set('powershell', options.spawnHook)
    return { name: 'powershell' }
  },
  defineTool: (definition: unknown) => definition,
}))
vi.mock('../../pi-session-lifecycle', () => ({
  createOpenWaggleAgentSessionFromServices: mocks.createSession,
}))

import { createPiSessionForRun } from '../pi-run-session'

beforeEach(() => {
  mocks.hooks.clear()
  mocks.createSession.mockResolvedValue({ session: { setThinkingLevel: vi.fn() } })
})

it('applies persisted removals to both Pi shell tools without mutating their ambient environment', async () => {
  await createPiSessionForRun(
    fromPartial({
      preparedEnvironment: { HTTPS_PROXY: null, READY: 'yes', EMPTY: '' },
      projectRoot: '/project',
      workspacePath: '/workspace',
      services: { cwd: '/workspace' },
      sessionManager: { buildSessionContext: () => ({ messages: [] }) },
      thinkingLevel: 'off',
    }),
  )
  for (const name of ['bash', 'powershell']) {
    const hook = mocks.hooks.get(name)
    if (!hook) throw new Error(`Missing ${name} spawn hook`)
    const context = {
      command: 'user command',
      cwd: '/workspace',
      env: { HTTPS_PROXY: 'inherited', KEEP: 'value' },
    }
    expect(hook(context)).toEqual({
      ...context,
      env: {
        KEEP: 'value',
        READY: 'yes',
        EMPTY: '',
        OPENWAGGLE_PROJECT_ROOT: '/project',
        OPENWAGGLE_WORKTREE_PATH: '/workspace',
        OPENWAGGLE_AGENT_RUN: '1',
      },
    })
    expect(context.env.HTTPS_PROXY).toBe('inherited')
  }
})

it('keeps current workspace paths authoritative for both Pi shell tools', async () => {
  await createPiSessionForRun(
    fromPartial({
      preparedEnvironment: {
        OPENWAGGLE_PROJECT_ROOT: '/stale/project',
        OPENWAGGLE_WORKTREE_PATH: null,
        READY: 'yes',
      },
      projectRoot: '/current/project',
      workspacePath: '/current/tree',
      services: { cwd: '/current/tree' },
      sessionManager: { buildSessionContext: () => ({ messages: [] }) },
      thinkingLevel: 'off',
    }),
  )
  for (const name of ['bash', 'powershell']) {
    const hook = mocks.hooks.get(name)
    if (!hook) throw new Error(`Missing ${name} spawn hook`)
    expect(
      hook({
        command: 'pwd',
        cwd: '/current/tree',
        env: {
          OPENWAGGLE_PROJECT_ROOT: '/stale/inherited/project',
          openwaggle_worktree_path: '/stale/inherited/tree',
        },
      }).env,
    ).toEqual({
      OPENWAGGLE_PROJECT_ROOT: '/current/project',
      OPENWAGGLE_WORKTREE_PATH: '/current/tree',
      READY: 'yes',
      OPENWAGGLE_AGENT_RUN: '1',
    })
  }
})
