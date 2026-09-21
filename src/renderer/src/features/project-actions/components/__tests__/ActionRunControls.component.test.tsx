import type { ActionRun } from '@shared/types/action-runs'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useComposerStore } from '@/features/composer/state'
import { TEST_ACTION } from './native-action-fixtures'

const mocks = vi.hoisted(() => ({ manage: vi.fn(), draft: vi.fn(), open: vi.fn(), copy: vi.fn() }))
vi.mock('@/shared/lib/ipc', () => ({ api: { manageProjectActions: mocks.manage } }))
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
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: mocks.copy },
    })
  })
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
})
