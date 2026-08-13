import { WORKSPACE_FILES } from '@shared/constants/resource-limits'
import { describe, expect, it } from 'vitest'
import { workspaceExplorerSearch } from '../WorkspaceFileBrowser'

describe('workspace file explorer search', () => {
  it('uses a server-backed query so files beyond the initial tree remain discoverable', () => {
    expect(workspaceExplorerSearch(' deep/target.ts ')).toEqual({
      query: 'deep/target.ts',
      limit: WORKSPACE_FILES.PICKER_RESULT_LIMIT,
    })
    expect(workspaceExplorerSearch('')).toEqual({
      query: '',
      limit: WORKSPACE_FILES.EXPLORER_RESULT_LIMIT + 1,
    })
  })
})
