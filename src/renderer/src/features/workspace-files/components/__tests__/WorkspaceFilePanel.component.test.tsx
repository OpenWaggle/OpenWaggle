import type {
  WorkspaceBinaryFileReadResult,
  WorkspaceTextFileReadResult,
} from '@shared/types/workspace-files'
import { fireEvent, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useUIStore } from '@/shell/ui-store'
import { renderWithQueryClient } from '@/test-utils/query-test-utils'

const mocks = vi.hoisted(() => ({
  onWorkspaceFilesChanged: vi.fn(() => vi.fn()),
  openWorkspaceFileExternal: vi.fn(),
  readWorkspaceFile: vi.fn(),
  unwatchWorkspaceFiles: vi.fn().mockResolvedValue(undefined),
  watchWorkspaceFiles: vi.fn().mockResolvedValue(undefined),
  writeWorkspaceFile: vi.fn(),
  createObjectURL: vi.fn(() => 'blob:workspace-preview'),
  revokeObjectURL: vi.fn(),
}))

vi.mock('@/shared/lib/ipc', () => ({
  api: mocks,
}))

import { WorkspaceFilePanel } from '../WorkspaceFilePanel'

const FILE: WorkspaceTextFileReadResult = {
  path: 'src/example.ts',
  basename: 'example.ts',
  size: 17,
  modifiedAt: 1,
  revision: 'revision-1',
  mimeType: 'text/typescript',
  previewKind: 'text',
  content: 'export const x = 1',
  language: 'typescript',
  documentVersion: 0,
  fidelity: {
    encoding: 'utf-8',
    lineEnding: 'none',
    finalNewline: false,
    indentStyle: 'space',
    indentSize: 2,
    editorConfigApplied: false,
  },
}

const IMAGE_FILE: WorkspaceBinaryFileReadResult = {
  path: 'assets/example.png',
  basename: 'example.png',
  size: 3,
  modifiedAt: 1,
  revision: 'image-revision-1',
  mimeType: 'image/png',
  previewKind: 'image',
  data: Uint8Array.from([1, 2, 3]),
}

describe('WorkspaceFilePanel external open', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Object.defineProperties(URL, {
      createObjectURL: { configurable: true, value: mocks.createObjectURL },
      revokeObjectURL: { configurable: true, value: mocks.revokeObjectURL },
    })
    useUIStore.getState().clearToast()
    mocks.readWorkspaceFile.mockResolvedValue(FILE)
  })

  afterEach(() => {
    useUIStore.getState().clearToast()
  })

  it('surfaces an external-editor rejection as an error toast', async () => {
    mocks.openWorkspaceFileExternal.mockRejectedValue(new Error('No editor is registered'))
    renderWithQueryClient(
      <WorkspaceFilePanel
        projectPath="/project"
        relativePath="src/example.ts"
        line={null}
        onClose={vi.fn()}
        onOpenFile={vi.fn()}
      />,
    )
    const openButton = await screen.findByRole('button', { name: 'Open file in external editor' })

    fireEvent.click(openButton)

    await vi.waitFor(() =>
      expect(useUIStore.getState().toastData).toEqual({
        message: 'No editor is registered',
        variant: 'error',
      }),
    )
  })

  it('releases a binary preview URL when the preview unmounts', async () => {
    mocks.readWorkspaceFile.mockResolvedValue(IMAGE_FILE)
    const view = renderWithQueryClient(
      <WorkspaceFilePanel
        projectPath="/project"
        relativePath="assets/example.png"
        line={null}
        onClose={vi.fn()}
        onOpenFile={vi.fn()}
      />,
    )

    expect(await screen.findByRole('img', { name: 'example.png' })).toBeInTheDocument()
    expect(mocks.createObjectURL).toHaveBeenCalledTimes(1)

    view.unmount()

    expect(mocks.revokeObjectURL).toHaveBeenCalledWith('blob:workspace-preview')
  })
})
