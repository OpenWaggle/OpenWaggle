import type { WorkspaceTextFileReadResult } from '@shared/types/workspace-files'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useUIStore } from '@/shell/ui-store'
import { renderWithQueryClient } from '@/test-utils/query-test-utils'
import { WorkspaceFileEditor } from '../WorkspaceFileEditor'

const applyWorkspaceDocumentEditsMock = vi.hoisted(() => vi.fn())

vi.mock('@/shared/lib/ipc', () => ({
  api: {
    applyWorkspaceDocumentEdits: applyWorkspaceDocumentEditsMock,
    listSyntaxThemes: vi.fn().mockResolvedValue({ themes: [], languages: [], appearances: [] }),
  },
}))

vi.mock('@/shared/ui/FocusedSourceEditor', () => ({
  FocusedSourceEditor: ({
    onChange,
    path,
    source,
  }: {
    readonly onChange: (
      changes: readonly { rangeOffset: number; rangeLength: number; text: string }[],
      readSource: () => string,
    ) => void
    readonly path: string
    readonly source: string
  }) => {
    return (
      <textarea
        aria-label={`Edit ${path}`}
        value={source}
        onChange={(event) => {
          const value = event.currentTarget.value
          onChange([{ rangeOffset: 0, rangeLength: source.length, text: value }], () => value)
        }}
      />
    )
  },
}))

const mixedLineEndingsFile: WorkspaceTextFileReadResult = {
  path: 'src/example.ts',
  basename: 'example.ts',
  size: 24,
  modifiedAt: 1,
  revision: 'revision-1',
  mimeType: 'text/typescript',
  previewKind: 'text',
  content: 'first line\r\nsecond line\n',
  language: 'typescript',
  documentVersion: 0,
  fidelity: {
    encoding: 'utf-8',
    lineEnding: 'mixed',
    finalNewline: true,
    indentStyle: 'space',
    indentSize: 2,
    editorConfigApplied: false,
  },
}

describe('WorkspaceFileEditor line-ending normalization', () => {
  beforeEach(() => {
    applyWorkspaceDocumentEditsMock.mockReset()
    useUIStore.getState().clearToast()
  })

  it('surfaces a normalization rejection through the shared editor error path', async () => {
    applyWorkspaceDocumentEditsMock.mockRejectedValueOnce(new Error('Disk is read-only'))
    renderWithQueryClient(
      <WorkspaceFileEditor projectPath="/project" file={mixedLineEndingsFile} targetLine={null} />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    fireEvent.click(screen.getByRole('button', { name: 'Normalize to LF' }))

    await waitFor(() =>
      expect(useUIStore.getState().toastData).toEqual({
        message: 'Disk is read-only',
        variant: 'error',
      }),
    )
  })

  it('preserves the detected encoding when normalizing line endings', async () => {
    applyWorkspaceDocumentEditsMock.mockResolvedValueOnce({
      status: 'saved',
      version: 1,
      size: 44,
      modifiedAt: 2,
      revision: 'revision-2',
      encoding: 'utf-16le',
      lineEnding: 'lf',
    })
    renderWithQueryClient(
      <WorkspaceFileEditor
        projectPath="/project"
        file={{
          ...mixedLineEndingsFile,
          fidelity: {
            ...mixedLineEndingsFile.fidelity,
            encoding: 'utf-16le',
            editorConfigPolicy: { encoding: 'utf-8' },
          },
        }}
        targetLine={null}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    fireEvent.click(screen.getByRole('button', { name: 'Normalize to LF' }))

    await waitFor(() =>
      expect(applyWorkspaceDocumentEditsMock).toHaveBeenCalledWith(
        expect.objectContaining({
          normalizeLineEnding: 'lf',
          targetEncoding: 'utf-16le',
        }),
      ),
    )
  })
})
