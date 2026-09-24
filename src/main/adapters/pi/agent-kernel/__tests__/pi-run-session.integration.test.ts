import type { ToolDefinition } from '@earendil-works/pi-coding-agent'
import { fromPartial } from '@total-typescript/shoehorn'
import { expect, it, vi } from 'vitest'
import { createPiSessionForRun } from '../pi-run-session'

const mocks = vi.hoisted(() => ({ createSession: vi.fn() }))

vi.mock('../../pi-session-lifecycle', () => ({
  createOpenWaggleAgentSessionFromServices: mocks.createSession,
}))

it.skipIf(process.platform === 'win32')(
  'passes authoritative workspace paths through the real Pi Bash spawn context',
  async () => {
    const workspacePath = process.cwd()
    const projectRoot = '/authoritative/project'
    mocks.createSession.mockResolvedValue({ session: { setThinkingLevel: vi.fn() } })

    await createPiSessionForRun(
      fromPartial({
        projectRoot,
        workspacePath,
        preparedEnvironment: {
          OPENWAGGLE_PROJECT_ROOT: '/stale/project',
          OPENWAGGLE_WORKTREE_PATH: null,
          READY: 'yes',
        },
        services: { cwd: workspacePath },
        sessionManager: { buildSessionContext: () => ({ messages: [] }) },
        thinkingLevel: 'off',
      }),
    )

    const customTools: ToolDefinition[] = mocks.createSession.mock.lastCall?.[0]?.customTools ?? []
    const bash = customTools.find((tool) => tool.name === 'bash')
    if (!bash) throw new Error('Pi Bash tool was not registered')

    const result = await bash.execute(
      'workspace-context',
      {
        command:
          'printf "%s|%s|%s|%s" "$OPENWAGGLE_PROJECT_ROOT" "$OPENWAGGLE_WORKTREE_PATH" "$READY" "$OPENWAGGLE_AGENT_RUN"',
      },
      undefined,
      undefined,
      fromPartial({
        sessionManager: {
          getSessionId: () => 'integration-session',
          getSessionFile: () => null,
        },
      }),
    )
    const output = result.content
      .filter((content) => content.type === 'text')
      .map((content) => content.text)
      .join('')
    expect(output).toContain(`${projectRoot}|${workspacePath}|yes|1`)
  },
)
