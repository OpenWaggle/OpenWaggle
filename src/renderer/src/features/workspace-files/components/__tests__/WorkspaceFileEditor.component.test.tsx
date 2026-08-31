import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { useEffect, useRef, useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Button } from '@/shared/ui/Button'
import { renderWithQueryClient } from '@/test-utils/query-test-utils'
import { WorkspaceFileEditor } from '../WorkspaceFileEditor'
import { workspaceTextFileFixture as file } from './workspace-file-editor-test-fixtures'

const applyWorkspaceDocumentEditsMock = vi.hoisted(() => vi.fn())
const readWorkspaceFileMock = vi.hoisted(() => vi.fn())
const focusedSourceEditorRenderMock = vi.hoisted(() => vi.fn())
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
    cacheKey,
    targetLine,
    onChange,
  }: {
    source: string
    path: string
    cacheKey: string
    targetLine: number | null
    onChange: (
      changes: readonly { rangeOffset: number; rangeLength: number; text: string }[],
      readSource: () => string,
    ) => void
  }) => {
    focusedSourceEditorRenderMock(cacheKey, source)
    const ref = useRef<HTMLTextAreaElement | null>(null)
    const revealedLineRef = useRef<number | null>(null)
    useEffect(() => {
      if (!targetLine || !ref.current) return
      if (revealedLineRef.current === targetLine) return
      revealedLineRef.current = targetLine
      const lines = source.split('\n')
      const start = lines.slice(0, targetLine - 1).reduce((sum, line) => sum + line.length + 1, 0)
      const end = start + (lines[targetLine - 1]?.length ?? 0)
      ref.current.focus()
      ref.current.setSelectionRange(start, end)
    }, [source, targetLine])
    return (
      <textarea
        ref={ref}
        aria-label={`Edit ${path}`}
        value={source}
        onChange={(event) => {
          const value = event.currentTarget.value
          onChange(
            [
              {
                rangeOffset: 0,
                rangeLength: source.length,
                text: value,
              },
            ],
            () => value,
          )
        }}
      />
    )
  },
}))
describe('WorkspaceFileEditor', () => {
  afterEach(() => vi.useRealTimers())

  beforeEach(() => {
    window.localStorage.clear()
    applyWorkspaceDocumentEditsMock.mockReset()
    readWorkspaceFileMock.mockReset()
    focusedSourceEditorRenderMock.mockReset()
    applyWorkspaceDocumentEditsMock.mockResolvedValue({
      status: 'saved',
      version: 1,
      size: 25,
      modifiedAt: 2,
      revision: 'revision-2',
    })
  })
  it('queues the newest draft when closing during an in-flight autosave', async () => {
    vi.useFakeTimers()
    let resolveFirstSave:
      | ((value: Awaited<ReturnType<typeof applyWorkspaceDocumentEditsMock>>) => void)
      | null = null
    applyWorkspaceDocumentEditsMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveFirstSave = resolve
        }),
    )
    const view = renderWithQueryClient(
      <WorkspaceFileEditor projectPath="/project" file={file} targetLine={null} />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    await act(async () => Promise.resolve())
    const editor = screen.getByRole('textbox', { name: 'Edit src/example.ts' })
    fireEvent.change(editor, { target: { value: 'draft A' } })
    await act(() => vi.advanceTimersByTimeAsync(500))
    expect(applyWorkspaceDocumentEditsMock).toHaveBeenCalledTimes(1)

    fireEvent.change(editor, { target: { value: 'draft B' } })
    view.unmount()
    await act(async () => {
      resolveFirstSave?.({
        status: 'saved',
        version: 1,
        size: 7,
        modifiedAt: 2,
        revision: 'revision-2',
      })
      await Promise.resolve()
    })

    await vi.waitFor(() => expect(applyWorkspaceDocumentEditsMock).toHaveBeenCalledTimes(2))
    expect(applyWorkspaceDocumentEditsMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        expectedRevision: 'revision-2',
        baseVersion: 1,
        batches: [
          expect.objectContaining({
            version: 2,
            changes: [expect.objectContaining({ text: 'draft B' })],
          }),
        ],
      }),
    )
    vi.useRealTimers()
  })

  it('recovers the freshest draft when an in-flight write conflicts after closing', async () => {
    vi.useFakeTimers()
    const conflictFile = { ...file, path: 'src/conflict.ts', basename: 'conflict.ts' }
    let resolveFirstSave:
      | ((value: Awaited<ReturnType<typeof applyWorkspaceDocumentEditsMock>>) => void)
      | null = null
    applyWorkspaceDocumentEditsMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveFirstSave = resolve
        }),
    )
    const view = renderWithQueryClient(
      <WorkspaceFileEditor projectPath="/project" file={conflictFile} targetLine={null} />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    await act(async () => Promise.resolve())
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
    expect(applyWorkspaceDocumentEditsMock).toHaveBeenCalledTimes(1)

    readWorkspaceFileMock.mockResolvedValue(conflictFile)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Use Disk' }))
      await Promise.resolve()
    })
    expect(readWorkspaceFileMock).toHaveBeenCalledOnce()
    reopened.unmount()
  })

  it('distinguishes a save failure from an external-change conflict and offers retry', async () => {
    vi.useFakeTimers()
    applyWorkspaceDocumentEditsMock.mockRejectedValueOnce(new Error('Disk is full'))
    renderWithQueryClient(
      <WorkspaceFileEditor projectPath="/project" file={file} targetLine={null} />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    await act(async () => Promise.resolve())
    fireEvent.change(screen.getByRole('textbox', { name: 'Edit src/example.ts' }), {
      target: { value: 'unsaved draft' },
    })
    await act(() => vi.advanceTimersByTimeAsync(500))

    expect(screen.getByText('Save failed')).toHaveAttribute('title', 'Disk is full')
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Use Disk' })).not.toBeInTheDocument()
  })

  it('keeps search results in review mode until focused editing is explicit', async () => {
    const setSelectionRange = vi.spyOn(HTMLTextAreaElement.prototype, 'setSelectionRange')
    renderWithQueryClient(<WorkspaceFileEditor projectPath="/project" file={file} targetLine={2} />)

    expect(screen.getByRole('region', { name: 'Source for src/example.ts' })).toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: 'Edit src/example.ts' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    const editor = await screen.findByRole('textbox', { name: 'Edit src/example.ts' })
    await waitFor(() => expect(setSelectionRange).toHaveBeenCalledWith(11, 22))
    setSelectionRange.mockClear()

    fireEvent.change(editor, { target: { value: 'first line\nsecond line updated\n' } })

    expect(setSelectionRange).not.toHaveBeenCalled()
    setSelectionRange.mockRestore()
  })

  it('remounts a clean focused editor only after an external revision and source agree', async () => {
    const externalFile = {
      ...file,
      content: 'externally replaced\n',
      documentVersion: 1,
      revision: 'revision-2',
      fidelity: {
        ...file.fidelity,
        encoding: 'utf-16le' as const,
        lineEnding: 'crlf' as const,
      },
    }
    function ExternalChangeHarness() {
      const [currentFile, setCurrentFile] = useState(file)
      return (
        <>
          <Button type="button" onClick={() => setCurrentFile(externalFile)}>
            Apply external change
          </Button>
          <WorkspaceFileEditor projectPath="/project" file={currentFile} targetLine={null} />
        </>
      )
    }
    renderWithQueryClient(<ExternalChangeHarness />)
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    await screen.findByRole('textbox', { name: 'Edit src/example.ts' })
    focusedSourceEditorRenderMock.mockClear()

    fireEvent.click(screen.getByRole('button', { name: 'Apply external change' }))

    await waitFor(() =>
      expect(focusedSourceEditorRenderMock).toHaveBeenCalledWith(
        expect.stringContaining('revision-2'),
        externalFile.content,
      ),
    )
    expect(focusedSourceEditorRenderMock).not.toHaveBeenCalledWith(
      expect.stringContaining('revision-2'),
      file.content,
    )
    expect(screen.getByRole('textbox', { name: 'Edit src/example.ts' })).toHaveValue(
      externalFile.content,
    )
    expect(screen.getByText('UTF-16LE')).toBeInTheDocument()
    expect(screen.getByText('CRLF')).toBeInTheDocument()
  })

  it('opens a Markdown content-search result in review mode and edits on request', async () => {
    const markdownFile: WorkspaceTextFileReadResult = {
      ...file,
      path: 'docs/guide.md',
      basename: 'guide.md',
      mimeType: 'text/markdown',
      previewKind: 'markdown',
      language: 'markdown',
    }
    const setSelectionRange = vi.spyOn(HTMLTextAreaElement.prototype, 'setSelectionRange')

    renderWithQueryClient(
      <WorkspaceFileEditor projectPath="/project" file={markdownFile} targetLine={2} />,
    )

    expect(screen.getByRole('region', { name: 'Source for docs/guide.md' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    expect(await screen.findByRole('textbox', { name: 'Edit docs/guide.md' })).toHaveFocus()
    await waitFor(() => expect(setSelectionRange).toHaveBeenCalledWith(11, 22))
    setSelectionRange.mockRestore()
  })

  it('loads the focused editor only after the user chooses Edit', async () => {
    renderWithQueryClient(
      <WorkspaceFileEditor projectPath="/project" file={file} targetLine={null} />,
    )

    expect(screen.queryByRole('textbox', { name: 'Edit src/example.ts' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    expect(await screen.findByRole('textbox', { name: 'Edit src/example.ts' })).toBeInTheDocument()
  })
})
