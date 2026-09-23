import { actionExecutionKey } from '@shared/utils/action-execution-key'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { useUIStore } from '@/shell/ui-store'
import { TEST_ACTION } from '../../components/__tests__/native-action-fixtures'

const mocks = vi.hoisted(() => ({ manage: vi.fn(), open: vi.fn(), toast: vi.fn() }))
vi.mock('@/features/chat/hooks', () => ({
  useChat: () => ({ activeSession: { id: 'session', projectPath: '/repo' } }),
}))
vi.mock('@/shared/lib/ipc', () => ({ api: { manageProjectActions: mocks.manage } }))
vi.mock('@/shell/workspace-panel-actions', () => ({ openWorkspaceAction: mocks.open }))

import { useRunProjectAction } from '../useRunProjectAction'

beforeEach(() => {
  vi.clearAllMocks()
  useUIStore.setState({ showToast: mocks.toast })
  mocks.manage.mockResolvedValue({ type: 'run', run: { id: 'run-one' } })
})

it('binds a menu launch to the displayed native definition', async () => {
  const { result } = renderHook(() => useRunProjectAction('/repo'))
  await act(async () => {
    expect(await result.current(TEST_ACTION)).toBe(true)
  })
  expect(mocks.manage).toHaveBeenCalledWith({
    scope: { projectPath: '/repo', sessionId: 'session' },
    operation: {
      type: 'start',
      actionId: TEST_ACTION.id,
      expectedExecutionKey: actionExecutionKey(TEST_ACTION),
      requestId: expect.any(String),
    },
  })
  expect(mocks.open).toHaveBeenCalledWith('session', '/repo', 'run-one')
})

it('uses the displayed shortcut key and surfaces a changed-definition refusal', async () => {
  const { result } = renderHook(() => useRunProjectAction('/repo'))
  mocks.manage.mockRejectedValueOnce(new Error('The action changed during authorization.'))
  await act(async () => {
    expect(
      await result.current({
        id: TEST_ACTION.id,
        name: TEST_ACTION.name,
        command: 'pnpm test',
        icon: TEST_ACTION.icon,
        runOnWorktreeCreate: false,
        executionKey: actionExecutionKey(TEST_ACTION),
      }),
    ).toBe(false)
  })
  expect(mocks.manage.mock.calls[0]?.[0]?.operation.expectedExecutionKey).toBe(
    actionExecutionKey(TEST_ACTION),
  )
  expect(mocks.toast).toHaveBeenCalledWith('The action changed during authorization.', 'error')
  expect(mocks.open).not.toHaveBeenCalled()
})

it('does not launch a legacy shortcut without a displayed execution key', async () => {
  const { result } = renderHook(() => useRunProjectAction('/repo'))
  await act(async () => {
    expect(
      await result.current({
        id: TEST_ACTION.id,
        name: TEST_ACTION.name,
        command: 'pnpm test',
        icon: TEST_ACTION.icon,
        runOnWorktreeCreate: false,
      }),
    ).toBe(false)
  })
  expect(mocks.manage).not.toHaveBeenCalled()
  expect(mocks.toast).toHaveBeenCalledWith('Reload actions before running this shortcut.', 'error')
})
