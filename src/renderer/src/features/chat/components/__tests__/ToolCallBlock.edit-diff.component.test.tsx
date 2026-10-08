import { fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ToolCallBlock } from '../ToolCallBlock'

const mockCopyToClipboard = vi.hoisted(() => vi.fn())
const mockOpenWorkspaceFile = vi.hoisted(() => vi.fn())

vi.mock('@/shared/lib/ipc', () => ({
  api: {
    copyToClipboard: (...args: unknown[]) => mockCopyToClipboard(...args),
  },
}))

vi.mock('@/features/workspace-files/hooks', () => ({
  useOpenWorkspaceFile: () => mockOpenWorkspaceFile,
}))

vi.mock('@pierre/diffs/react', () => ({
  PatchDiff: ({ patch }: { readonly patch: string }) => (
    <div data-testid="diffs-container">
      <pre data-testid="patch-diff">{patch}</pre>
    </div>
  ),
  useWorkerPool: () => undefined,
  WorkerPoolContextProvider: ({ children }: { readonly children: ReactNode }) => children,
}))

/** The diff renderer is lazy-loaded; its first import is slow under the component runner. */
const LAZY_DIFF_TIMEOUT_MS = 15_000
const EDIT_ARGS = JSON.stringify({
  path: 'src/geo.ts',
  edits: [{ oldText: 'const old = 3', newText: 'const next = 3' }],
})
const EDIT_PATCH = [
  '--- src/geo.ts',
  '+++ src/geo.ts',
  '@@ -10,3 +10,3 @@',
  ' const one = 1',
  '-const old = 3',
  '+const next = 3',
  ' export {}',
  '',
].join('\n')

function editResult(details: Record<string, unknown>) {
  return {
    content: {
      content: [{ type: 'text', text: 'Successfully replaced 1 block(s) in src/geo.ts.' }],
      details,
    },
    state: 'complete',
  }
}

describe('ToolCallBlock edit diffs (ADR 0050)', () => {
  beforeEach(() => {
    mockCopyToClipboard.mockReset()
    mockOpenWorkspaceFile.mockReset()
  })

  it('shows the file diff instead of raw arguments when an edit row expands', async () => {
    render(
      <ToolCallBlock
        name="edit"
        args={EDIT_ARGS}
        state="complete"
        result={editResult({ diff: 'display', patch: EDIT_PATCH, firstChangedLine: 11 })}
      />,
    )

    expect(screen.queryByTestId('patch-diff')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /Edited src\/geo\.ts/ }))

    expect(
      await screen.findByTestId('patch-diff', undefined, { timeout: LAZY_DIFF_TIMEOUT_MS }),
    ).toHaveTextContent('+const next = 3')
    expect(screen.queryByText('Arguments')).toBeNull()
    expect(screen.queryByText(/Successfully replaced/)).toBeNull()
    expect(screen.getAllByText('1 additions, 1 deletions')).toHaveLength(2)

    fireEvent.click(screen.getByRole('button', { name: 'Copy diff' }))
    expect(mockCopyToClipboard).toHaveBeenLastCalledWith(EDIT_PATCH)
    fireEvent.click(screen.getByRole('button', { name: 'Copy args' }))
    expect(mockCopyToClipboard).toHaveBeenLastCalledWith(EDIT_ARGS)
  })

  it('opens the edited file at its first changed line', () => {
    render(
      <ToolCallBlock
        name="edit"
        args={EDIT_ARGS}
        state="complete"
        result={editResult({ patch: EDIT_PATCH, firstChangedLine: 11 })}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /Edited src\/geo\.ts/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Open src/geo.ts' }))

    expect(mockOpenWorkspaceFile).toHaveBeenCalledWith('src/geo.ts', 11)
  })

  it('shows the display diff as text for edits recorded without a patch', () => {
    render(
      <ToolCallBlock
        name="edit"
        args={EDIT_ARGS}
        state="complete"
        result={editResult({ diff: '-10 const old = 3\n+10 const next = 3' })}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /Edited src\/geo\.ts/ }))

    expect(screen.queryByTestId('patch-diff')).toBeNull()
    expect(screen.getByLabelText('Edit diff')).toHaveTextContent('+10 const next = 3')
  })

  it('keeps arguments and the error for a failed edit', () => {
    render(
      <ToolCallBlock
        name="edit"
        args={EDIT_ARGS}
        state="complete"
        result={{ content: 'Could not find the exact text in src/geo.ts.', state: 'error' }}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /src\/geo\.ts/ }))

    expect(screen.getByText('Arguments')).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('Could not find the exact text')
    expect(screen.queryByRole('button', { name: 'Copy diff' })).toBeNull()
  })
})
