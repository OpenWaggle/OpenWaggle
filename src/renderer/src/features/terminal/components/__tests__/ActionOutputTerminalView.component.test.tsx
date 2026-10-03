import type { ActionOutputSnapshot, ActionRun } from '@shared/types/action-runs'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useActionOutputViewStore } from '../../state/action-output-view-store'
import { useTerminalStore } from '../../state/terminal-store'

const mocks = vi.hoisted(() => {
  const writes: string[] = []
  const options: Record<string, unknown>[] = []
  return { manage: vi.fn(), copy: vi.fn(), writes, onData: vi.fn(), options }
})

vi.mock('@/shared/lib/ipc', () => ({
  api: { manageProjectActions: mocks.manage, copyToClipboard: mocks.copy },
}))
vi.mock('@/features/workspace-files', () => ({
  useOpenWorkspaceFile: () => vi.fn(),
  openAbsoluteFileInPreferredWorkspaceEditor: vi.fn(),
}))
vi.mock('@xterm/xterm', () => ({
  Terminal: class {
    cols = 80
    rows = 24
    options: Record<string, unknown>
    buffer = { active: { getLine: vi.fn() } }
    write = vi.fn((data: string, callback?: () => void) => {
      mocks.writes.push(data)
      callback?.()
    })
    constructor(options: Record<string, unknown> = {}) {
      this.options = options
      mocks.options.push(this.options)
    }
    dispose = vi.fn()
    focus = vi.fn()
    getSelection = vi.fn(() => '')
    loadAddon() {}
    open() {}
    onData = mocks.onData
    registerLinkProvider() {
      return { dispose: () => undefined }
    }
    attachCustomKeyEventHandler() {}
  },
}))
vi.mock('@xterm/addon-fit', () => ({
  FitAddon: class {
    fit = vi.fn()
    dispose() {}
  },
}))
vi.mock('@xterm/addon-search', () => ({
  SearchAddon: class {
    findNext = vi.fn()
    findPrevious = vi.fn()
    clearDecorations = vi.fn()
    dispose = vi.fn()
  },
}))

import { TerminalPanel } from '../TerminalPanel'

const OWNER = 'session-1'

function runSnapshot(status: ActionRun['status']): ActionRun {
  return {
    id: 'run-1',
    requestId: 'request',
    workspaceId: 'workspace',
    projectPath: '/repo',
    workspacePath: '/repo',
    action: {
      id: 'dev',
      name: 'dev',
      icon: 'play',
      invocation: { type: 'command', command: 'pnpm dev', directory: '.' },
      kind: 'service',
      allowConcurrent: false,
      autoOpenPreview: false,
    },
    invocation: { type: 'command', command: 'pnpm dev', cwd: '/repo' },
    status,
    startedAt: 1,
    finishedAt: null,
    exitCode: status === 'completed' ? 0 : null,
    error: null,
    previewUrl: null,
    ready: false,
    outputBytes: 20,
  }
}

function outputPage(status: ActionRun['status']): ActionOutputSnapshot {
  return {
    run: runSnapshot(status),
    output: 'VITE ready in 120 ms\r\n',
    startOffset: 0,
    endOffset: 20,
    truncated: false,
    hasMore: false,
  }
}

describe('Action output terminal view', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.writes.length = 0
    mocks.options.length = 0
    Object.defineProperty(document, 'fonts', { configurable: true, value: new EventTarget() })
    useTerminalStore.setState({ groups: {}, activity: {}, portPreviews: {}, exits: {} })
    useActionOutputViewStore.setState({ views: {}, active: {} })
    mocks.manage.mockResolvedValue({ type: 'output', output: outputPage('completed') })
  })

  it('renders an existing run read-only in the drawer and closes without stopping it', async () => {
    useActionOutputViewStore
      .getState()
      .open(
        { ownerKey: OWNER, projectPath: '/repo', actionId: 'dev', runId: 'run-1', label: 'dev' },
        null,
      )
    render(<TerminalPanel ownerKey={OWNER} defaultCwd="/repo" onClose={() => undefined} />)

    const tab = screen.getByRole('tab', { name: 'dev · action output, read-only' })
    expect(tab).toHaveAttribute('aria-selected', 'true')
    await waitFor(() => expect(mocks.writes.join('')).toContain('VITE ready in 120 ms'))
    expect(await screen.findByText('completed · exit 0')).toBeVisible()
    expect(screen.getByText('Read-only')).toBeVisible()
    expect(mocks.options[0]).toMatchObject({ disableStdin: true })
    expect(mocks.onData).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Split terminal side by side' })).toBeDisabled()
    expect(mocks.manage).toHaveBeenCalledWith({
      scope: { projectPath: '/repo', sessionId: OWNER },
      operation: { type: 'output', runId: 'run-1', afterOffset: 0 },
    })

    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Close dev · action output' }))
    })
    expect(screen.queryByRole('tab', { name: /action output/ })).not.toBeInTheDocument()
    for (const [request] of mocks.manage.mock.calls)
      expect(request).toMatchObject({ operation: { type: 'output' } })
  })
})
