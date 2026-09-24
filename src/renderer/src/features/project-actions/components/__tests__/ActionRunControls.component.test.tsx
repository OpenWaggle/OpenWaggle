import type { ActionRun } from '@shared/types/action-runs'
import { actionExecutionKey } from '@shared/utils/action-execution-key'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useComposerStore } from '@/features/composer/state'
import { actionCatalog, TEST_ACTION } from './native-action-fixtures'

const mocks = vi.hoisted(() => ({ manage: vi.fn(), draft: vi.fn(), open: vi.fn(), copy: vi.fn() }))
vi.mock('@/shared/lib/ipc', () => ({
  api: { manageProjectActions: mocks.manage, copyToClipboard: mocks.copy },
}))
vi.mock('@/features/chat/lib', () => ({ setComposerTextValue: mocks.draft }))
vi.mock('@/shell/workspace-panel-actions', () => ({
  openWorkspaceAction: mocks.open,
  openWorkspacePreview: vi.fn(),
}))

import { ActionRunControls } from '../ActionRunControls'

const run: ActionRun = {
  id: 'run-one',
  requestId: 'start',
  workspaceId: 'workspace',
  projectPath: '/repo',
  workspacePath: '/repo',
  action: TEST_ACTION,
  invocation: { type: 'command', command: 'pnpm test', cwd: '/repo' },
  status: 'stopping',
  startedAt: 1,
  finishedAt: null,
  exitCode: null,
  error: 'Process tree is still running',
  previewUrl: null,
  ready: false,
  outputBytes: 5,
}
const scope = { projectPath: '/repo', sessionId: 'session' }

describe('Action run controls', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })
  afterEach(() => vi.restoreAllMocks())
  it.each([
    { platform: 'Linux', command: "pnpm run 'test unit; literal'" },
    { platform: 'Windows', command: "& 'pnpm' 'run' 'test unit; literal'" },
  ])(
    'copies literal commands and output through Electron on $platform',
    async ({ platform, command }) => {
      vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(platform)
      render(
        <ActionRunControls
          scope={scope}
          run={{
            ...run,
            invocation: {
              type: 'executable',
              executable: 'pnpm',
              args: ['run', 'test unit; literal'],
              cwd: '/repo',
            },
          }}
          output="quoted task passed"
        />,
      )
      fireEvent.click(screen.getByRole('button', { name: 'Copy command' }))
      await waitFor(() => expect(mocks.copy).toHaveBeenCalledWith(command))
      await waitFor(() => expect(screen.getByRole('button', { name: 'Copy output' })).toBeEnabled())
      fireEvent.click(screen.getByRole('button', { name: 'Copy output' }))
      await waitFor(() => expect(mocks.copy).toHaveBeenLastCalledWith('quoted task passed'))
    },
  )
  it('allows Stop to be retried after the owning process has not confirmed termination', async () => {
    mocks.manage
      .mockRejectedValueOnce(new Error('Still stopping'))
      .mockResolvedValueOnce({ type: 'run', run: { ...run, status: 'stopped' } })
    render(<ActionRunControls scope={scope} run={run} output="ready" />)
    fireEvent.click(screen.getByRole('button', { name: /^Stop$/ }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Still stopping')
    fireEvent.click(screen.getByRole('button', { name: /^Stop$/ }))
    await waitFor(() => expect(mocks.open).toHaveBeenCalledWith('session', '/repo', 'run-one'))
    expect(mocks.manage).toHaveBeenCalledTimes(2)
    expect(mocks.manage).toHaveBeenLastCalledWith({
      scope,
      operation: { type: 'stop', runId: 'run-one' },
    })
    expect(screen.getByRole('button', { name: 'Restart' })).toBeDisabled()
  })
  it('restarts the current action definition after the saved action changes', async () => {
    const edited = {
      ...TEST_ACTION,
      invocation: { type: 'command' as const, command: 'pnpm check', directory: '.' },
    }
    const catalog = actionCatalog()
    mocks.manage
      .mockResolvedValueOnce({
        type: 'catalog',
        catalog: { ...catalog, actions: [{ source: 'local', definition: edited }] },
      })
      .mockResolvedValueOnce({ type: 'run', run })
    render(<ActionRunControls scope={scope} run={{ ...run, status: 'failed' }} output="" />)
    fireEvent.click(screen.getByRole('button', { name: 'Restart' }))
    await waitFor(() =>
      expect(mocks.manage).toHaveBeenCalledWith({
        scope,
        operation: {
          type: 'start',
          actionId: TEST_ACTION.id,
          expectedExecutionKey: actionExecutionKey(edited),
          requestId: expect.any(String),
          restartRunId: run.id,
        },
      }),
    )
    expect(mocks.manage).toHaveBeenNthCalledWith(1, { scope, operation: { type: 'catalog' } })
    expect(mocks.open).toHaveBeenCalledWith('session', '/repo', 'run-one')
  })
  it('does not restart a deleted action', async () => {
    mocks.manage.mockResolvedValue({
      type: 'catalog',
      catalog: { ...actionCatalog(), actions: [] },
    })
    render(<ActionRunControls scope={scope} run={{ ...run, status: 'failed' }} output="" />)
    fireEvent.click(screen.getByRole('button', { name: 'Restart' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('no longer available')
    expect(mocks.manage).toHaveBeenCalledTimes(1)
  })
  it('prepares a repair request without sending or discarding the existing composer draft', () => {
    useComposerStore.setState({ input: 'Keep this draft' })
    render(
      <ActionRunControls
        scope={scope}
        run={{ ...run, status: 'failed', exitCode: 1 }}
        output="test failure"
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Fix with agent' }))
    expect(mocks.draft).toHaveBeenCalledWith(
      expect.stringContaining('Keep this draft\n\nInvestigate'),
    )
    expect(mocks.draft).toHaveBeenCalledWith(expect.stringContaining('test failure'))
    expect(mocks.manage).not.toHaveBeenCalled()
  })

  it('uses a Session-relative working directory in the repair draft', () => {
    const workspacePath =
      '/Users/diego/.openwaggle/worktrees/project/9a9b9c9d-1000-4000-8000-9a9b9c9d9e9f'
    render(
      <ActionRunControls
        scope={scope}
        run={{
          ...run,
          workspacePath,
          status: 'failed',
          invocation: { ...run.invocation, cwd: `${workspacePath}/packages/web` },
        }}
        output="test failure"
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Fix with agent' }))
    const draft = vi.mocked(mocks.draft).mock.lastCall?.[0] ?? ''
    expect(draft).toContain('Working directory: packages/web')
    expect(draft).not.toContain(workspacePath)
  })
})
