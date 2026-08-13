import type { WorkspaceTextFileReadResult } from '@shared/types/workspace-files'
import { fireEvent, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useUIStore } from '@/shell/ui-store'
import { renderWithQueryClient } from '@/test-utils/query-test-utils'

const mocks = vi.hoisted(() => ({
  openWorkspaceFileExternal: vi.fn(),
  readWorkspaceFile: vi.fn(),
  writeWorkspaceFile: vi.fn(),
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
}

describe('WorkspaceFilePanel external open', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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
    const openButton = await screen.findByRole('button', { name: 'Open file in default editor' })

    fireEvent.click(openButton)

    await vi.waitFor(() =>
      expect(useUIStore.getState().toastData).toEqual({
        message: 'No editor is registered',
        variant: 'error',
      }),
    )
  })
})
