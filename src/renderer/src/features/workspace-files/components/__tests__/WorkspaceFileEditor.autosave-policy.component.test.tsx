import type { WorkspaceTextFileReadResult } from '@shared/types/workspace-files'
import { act, fireEvent, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithQueryClient } from '@/test-utils/query-test-utils'
import { WorkspaceFileEditor } from '../WorkspaceFileEditor'
import { workspaceTextFileFixture } from './workspace-file-editor-test-fixtures'

const applyWorkspaceDocumentEditsMock = vi.hoisted(() => vi.fn())
const readWorkspaceFileMock = vi.hoisted(() => vi.fn())

vi.mock('@/shared/lib/ipc', () => ({
  api: {
    readWorkspaceFile: readWorkspaceFileMock,
    applyWorkspaceDocumentEdits: applyWorkspaceDocumentEditsMock,
  },
}))

vi.mock('@/shared/ui/FocusedSourceEditor', () => ({
  FocusedSourceEditor: ({
    source,
    path,
    onChange,
  }: {
    source: string
    path: string
    onChange: (
      changes: readonly { rangeOffset: number; rangeLength: number; text: string }[],
      readSource: () => string,
    ) => void
  }) => (
    <textarea
      aria-label={`Edit ${path}`}
      value={source}
      onChange={(event) => {
        const value = event.currentTarget.value
        onChange([{ rangeOffset: 0, rangeLength: source.length, text: value }], () => value)
      }}
    />
  ),
}))

describe('WorkspaceFileEditor autosave content policy', () => {
  afterEach(() => vi.useRealTimers())

  beforeEach(() => {
    window.localStorage.clear()
    applyWorkspaceDocumentEditsMock.mockReset()
    readWorkspaceFileMock.mockReset()
  })

  it('normalizes autosaved content and refreshes the focused editor', async () => {
    vi.useFakeTimers()
    const file: WorkspaceTextFileReadResult = {
      ...workspaceTextFileFixture,
      fidelity: {
        ...workspaceTextFileFixture.fidelity,
        editorConfigApplied: true,
        editorConfigPolicy: {
          trimTrailingWhitespace: true,
          finalNewline: true,
        },
      },
    }
    applyWorkspaceDocumentEditsMock.mockResolvedValueOnce({
      status: 'saved',
      version: 1,
      size: 16,
      modifiedAt: 2,
      revision: 'revision-2',
      encoding: 'utf-8',
      lineEnding: 'lf',
    })
    renderWithQueryClient(
      <WorkspaceFileEditor projectPath="/project" file={file} targetLine={null} />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    await act(async () => Promise.resolve())

    fireEvent.change(screen.getByRole('textbox', { name: 'Edit src/example.ts' }), {
      target: { value: 'const value = 1   ' },
    })
    await act(() => vi.advanceTimersByTimeAsync(500))

    expect(applyWorkspaceDocumentEditsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        batches: [
          expect.objectContaining({
            changes: [expect.objectContaining({ text: 'const value = 1\n' })],
          }),
        ],
      }),
    )
    expect(screen.getByRole('textbox', { name: 'Edit src/example.ts' })).toHaveValue(
      'const value = 1\n',
    )
  })
})
