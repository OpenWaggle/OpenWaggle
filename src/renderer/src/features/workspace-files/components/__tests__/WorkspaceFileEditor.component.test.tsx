import type { WorkspaceTextFileReadResult } from '@shared/types/workspace-files'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithQueryClient } from '@/test-utils/query-test-utils'
import { WorkspaceFileEditor } from '../WorkspaceFileEditor'

const writeWorkspaceFileMock = vi.hoisted(() => vi.fn())
const readWorkspaceFileMock = vi.hoisted(() => vi.fn())

vi.mock('@/shared/lib/ipc', () => ({
  api: {
    readWorkspaceFile: readWorkspaceFileMock,
    writeWorkspaceFile: writeWorkspaceFileMock,
  },
}))

const file: WorkspaceTextFileReadResult = {
  path: 'src/example.ts',
  basename: 'example.ts',
  size: 24,
  modifiedAt: 1,
  revision: 'revision-1',
  mimeType: 'text/typescript',
  previewKind: 'text',
  content: 'first line\nsecond line\n',
  language: 'typescript',
}

describe('WorkspaceFileEditor', () => {
  afterEach(() => vi.useRealTimers())

  beforeEach(() => {
    writeWorkspaceFileMock.mockReset()
    readWorkspaceFileMock.mockReset()
    writeWorkspaceFileMock.mockResolvedValue({
      status: 'saved',
      size: 25,
      modifiedAt: 2,
      revision: 'revision-2',
    })
  })

  it('queues the newest draft when closing during an in-flight autosave', async () => {
    vi.useFakeTimers()
    let resolveFirstSave:
      | ((value: Awaited<ReturnType<typeof writeWorkspaceFileMock>>) => void)
      | null = null
    writeWorkspaceFileMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveFirstSave = resolve
        }),
    )
    const view = renderWithQueryClient(
      <WorkspaceFileEditor projectPath="/project" file={file} targetLine={null} />,
    )
    const editor = screen.getByRole('textbox', { name: 'Edit src/example.ts' })

    fireEvent.change(editor, { target: { value: 'draft A' } })
    await act(() => vi.advanceTimersByTimeAsync(500))
    expect(writeWorkspaceFileMock).toHaveBeenCalledTimes(1)

    fireEvent.change(editor, { target: { value: 'draft B' } })
    view.unmount()
    await act(async () => {
      resolveFirstSave?.({ status: 'saved', size: 7, modifiedAt: 2, revision: 'revision-2' })
      await Promise.resolve()
    })

    await vi.waitFor(() => expect(writeWorkspaceFileMock).toHaveBeenCalledTimes(2))
    expect(writeWorkspaceFileMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ content: 'draft B', expectedRevision: 'revision-2' }),
    )
    vi.useRealTimers()
  })

  it('recovers the freshest draft when an in-flight write conflicts after closing', async () => {
    vi.useFakeTimers()
    const conflictFile = { ...file, path: 'src/conflict.ts', basename: 'conflict.ts' }
    let resolveFirstSave:
      | ((value: Awaited<ReturnType<typeof writeWorkspaceFileMock>>) => void)
      | null = null
    writeWorkspaceFileMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveFirstSave = resolve
        }),
    )
    const view = renderWithQueryClient(
      <WorkspaceFileEditor projectPath="/project" file={conflictFile} targetLine={null} />,
    )
    const editor = screen.getByRole('textbox', { name: 'Edit src/conflict.ts' })

    fireEvent.change(editor, { target: { value: 'draft A' } })
    await act(() => vi.advanceTimersByTimeAsync(500))
    fireEvent.change(editor, { target: { value: 'draft B' } })
    view.unmount()
    await act(async () => {
      resolveFirstSave?.({
        status: 'conflict',
        message: 'The file changed on disk. Reload it before saving your edits.',
      })
      await Promise.resolve()
    })

    const reopened = renderWithQueryClient(
      <WorkspaceFileEditor projectPath="/project" file={conflictFile} targetLine={null} />,
    )
    expect(screen.getByRole('textbox', { name: 'Edit src/conflict.ts' })).toHaveValue('draft B')
    expect(screen.getByText('Changed on disk')).toBeInTheDocument()
    await act(() => vi.advanceTimersByTimeAsync(500))
    expect(writeWorkspaceFileMock).toHaveBeenCalledTimes(1)

    readWorkspaceFileMock.mockResolvedValue(conflictFile)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Reload' }))
      await Promise.resolve()
    })
    expect(readWorkspaceFileMock).toHaveBeenCalledOnce()
    reopened.unmount()
  })

  it('distinguishes a save failure from an external-change conflict and offers retry', async () => {
    vi.useFakeTimers()
    writeWorkspaceFileMock.mockRejectedValueOnce(new Error('Disk is full'))
    renderWithQueryClient(
      <WorkspaceFileEditor projectPath="/project" file={file} targetLine={null} />,
    )

    fireEvent.change(screen.getByRole('textbox', { name: 'Edit src/example.ts' }), {
      target: { value: 'unsaved draft' },
    })
    await act(() => vi.advanceTimersByTimeAsync(500))

    expect(screen.getByText('Save failed')).toHaveAttribute('title', 'Disk is full')
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Reload' })).not.toBeInTheDocument()
  })

  it('focuses a searched line once without resetting the selection while editing', async () => {
    const setSelectionRange = vi.spyOn(HTMLTextAreaElement.prototype, 'setSelectionRange')
    renderWithQueryClient(<WorkspaceFileEditor projectPath="/project" file={file} targetLine={2} />)

    const editor = screen.getByRole('textbox', { name: 'Edit src/example.ts' })
    await waitFor(() => expect(setSelectionRange).toHaveBeenCalledWith(11, 22))
    setSelectionRange.mockClear()

    fireEvent.change(editor, { target: { value: 'first line\nsecond line updated\n' } })

    expect(setSelectionRange).not.toHaveBeenCalled()
    setSelectionRange.mockRestore()
  })
})
