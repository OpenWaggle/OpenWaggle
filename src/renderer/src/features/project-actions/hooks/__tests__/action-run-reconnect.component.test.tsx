import type { ActionRun } from '@shared/types/action-runs'
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TEST_ACTION } from '../../components/__tests__/native-action-fixtures'
import { useProjectActionStore } from '../../state/project-action-store'

const mocks = vi.hoisted(() => ({ manage: vi.fn(), preview: vi.fn() }))
vi.mock('@/shared/lib/ipc', () => ({ api: { manageProjectActions: mocks.manage } }))
vi.mock('@/shell/workspace-panel-actions', () => ({ openWorkspacePreview: mocks.preview }))

import { useActionOutput } from '../useActionOutput'
import { useActionPreview } from '../useActionPreview'

const scope = { projectPath: '/repo', sessionId: 'session' }
const run: ActionRun = {
  id: 'running',
  requestId: 'start',
  workspaceId: 'workspace',
  projectPath: '/repo',
  workspacePath: '/repo',
  action: { ...TEST_ACTION, autoOpenPreview: true },
  invocation: { type: 'command', command: 'pnpm test', cwd: '/repo' },
  status: 'running',
  startedAt: 1,
  finishedAt: null,
  exitCode: null,
  error: null,
  previewUrl: 'http://localhost:4318',
  ready: false,
  outputBytes: 5,
}
function output(text: string, startOffset: number, truncated = false) {
  return {
    type: 'output',
    output: {
      run,
      output: text,
      startOffset,
      endOffset: startOffset + text.length,
      truncated,
      hasMore: false,
    },
  }
}
describe('Action output and preview reconnect', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    useProjectActionStore.setState({ previewOpenedRuns: [] })
  })
  afterEach(() => {
    vi.useRealTimers()
  })
  it('retains output through transport loss and resumes at its cursor without submitting a start', async () => {
    mocks.manage
      .mockResolvedValueOnce(output('first', 0))
      .mockRejectedValueOnce(new Error('Host reconnecting'))
      .mockResolvedValueOnce(output('next', 12, true))
    const { result, unmount } = renderHook(() => useActionOutput(scope, run.id))
    await act(async () => {
      await Promise.resolve()
    })
    expect(result.current.output).toBe('first')
    await act(() => vi.advanceTimersByTimeAsync(750))
    expect(result.current).toMatchObject({ output: 'first', error: 'Host reconnecting' })
    await act(() => vi.advanceTimersByTimeAsync(750))
    expect(result.current.output).toContain('Output gap')
    expect(result.current.output).toContain('next')
    expect(result.current.truncated).toBe(true)
    expect(mocks.manage).toHaveBeenLastCalledWith({
      scope,
      operation: { type: 'output', runId: run.id, afterOffset: 5 },
    })
    expect(mocks.manage.mock.calls.every(([request]) => request.operation.type === 'output')).toBe(
      true,
    )
    unmount()
    const requests = mocks.manage.mock.calls.length
    await act(() => vi.advanceTimersByTimeAsync(3_000))
    expect(mocks.manage).toHaveBeenCalledTimes(requests)
  })
  it('does not schedule another poll when an in-flight reply arrives after unmount', async () => {
    const pending = Promise.withResolvers<ReturnType<typeof output>>()
    mocks.manage.mockReturnValueOnce(pending.promise)
    const { unmount } = renderHook(() => useActionOutput(scope, run.id))
    unmount()
    await act(async () => {
      pending.resolve(output('late', 0))
      await pending.promise
    })
    await act(() => vi.advanceTimersByTimeAsync(3_000))
    expect(mocks.manage).toHaveBeenCalledTimes(1)
  })
  it.each(['completed', 'failed', 'stopped', 'interrupted'] as const)(
    'drains every retained page of a %s run and then stops polling',
    async (status) => {
      const first = output('first', 0)
      const last = output('last', 5)
      const terminalRun = { ...run, status, finishedAt: 2 }
      mocks.manage
        .mockResolvedValueOnce({
          ...first,
          output: { ...first.output, run: terminalRun, hasMore: true },
        })
        .mockResolvedValue({ ...last, output: { ...last.output, run: terminalRun } })
      const { result, unmount } = renderHook(() => useActionOutput(scope, run.id))
      await act(async () => {
        await Promise.resolve()
      })
      await act(() => vi.advanceTimersByTimeAsync(0))
      expect(result.current.output).toBe('firstlast')
      expect(result.current.run?.status).toBe(status)
      expect(mocks.manage).toHaveBeenLastCalledWith({
        scope,
        operation: { type: 'output', runId: run.id, afterOffset: 5 },
      })
      await act(() => vi.advanceTimersByTimeAsync(3_000))
      expect(mocks.manage).toHaveBeenCalledTimes(2)
      unmount()
    },
  )
  it('opens an opted-in preview once after readiness, including after renderer remount', async () => {
    const hook = renderHook(({ ready }) => useActionPreview(scope, [{ ...run, ready }]), {
      initialProps: { ready: false },
    })
    expect(mocks.preview).not.toHaveBeenCalled()
    hook.rerender({ ready: true })
    await act(async () => {
      await Promise.resolve()
    })
    expect(mocks.preview).toHaveBeenCalledExactlyOnceWith('session', 'http://localhost:4318')
    hook.unmount()
    const reconnect = renderHook(() => useActionPreview(scope, [{ ...run, ready: true }]))
    await act(async () => {
      await Promise.resolve()
    })
    expect(mocks.preview).toHaveBeenCalledTimes(1)
    reconnect.unmount()
  })
})
