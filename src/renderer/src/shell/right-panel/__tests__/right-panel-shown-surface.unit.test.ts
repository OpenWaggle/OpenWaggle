import { describe, expect, it } from 'vitest'
import { extensionRightPanelSurfaceId } from '@/shared/lib/right-panel-surfaces'
import {
  extensionRightSidebarRequest,
  workspaceFileRightSidebarRequest,
} from '@/shared/lib/right-sidebar-coordinator'
import { resolveShownSurface } from '../right-panel-shown-surface'

const OWNER = 'session-1'

function route(requestKey: string) {
  return resolveShownSurface({
    claim: { kind: 'route', requestKey },
    ownerKey: OWNER,
    workspaceSurface: null,
    workspacePanelOpen: false,
  })
}

describe('resolveShownSurface', () => {
  it('maps route panels to their rail surface', () => {
    expect(route('diff')).toMatchObject({ open: true, shown: 'changes', highlight: 'changes' })
    expect(route('session-tree').shown).toBe('session-tree')
    expect(route('resources').shown).toBe('resources')
    expect(route(workspaceFileRightSidebarRequest('src/a.ts', 3)).shown).toBe('files')
    expect(route(extensionRightSidebarRequest('linear', 'issues', '/pkg', 'hash')).shown).toBe(
      extensionRightPanelSurfaceId({ extensionId: 'linear', sidePanelId: 'issues' }),
    )
  })

  it('highlights the owner of a surface opened from elsewhere without being it', () => {
    expect(route('change-request')).toMatchObject({ shown: null, highlight: 'changes' })
    expect(
      resolveShownSurface({
        claim: { kind: 'action-panel', previous: null },
        ownerKey: OWNER,
        workspaceSurface: null,
        workspacePanelOpen: false,
      }),
    ).toMatchObject({ open: true, shown: null, highlight: 'project-actions' })
    expect(
      resolveShownSurface({
        claim: { kind: 'workspace', ownerKey: OWNER },
        ownerKey: OWNER,
        workspaceSurface: { kind: 'action', projectPath: '/repo', runId: 'run-1' },
        workspacePanelOpen: true,
      }),
    ).toMatchObject({ shown: null, highlight: 'project-actions' })
  })

  it('treats a right-panel terminal as shown but belonging to no rail entry', () => {
    expect(
      resolveShownSurface({
        claim: { kind: 'workspace', ownerKey: OWNER },
        ownerKey: OWNER,
        workspaceSurface: { kind: 'terminal' },
        workspacePanelOpen: true,
      }),
    ).toEqual({ open: true, shown: null, highlight: null, kind: 'workspace' })
  })

  it('is closed without a claim or for another owner', () => {
    expect(
      resolveShownSurface({
        claim: null,
        ownerKey: OWNER,
        workspaceSurface: { kind: 'all-panels' },
        workspacePanelOpen: true,
      }).open,
    ).toBe(false)
    expect(
      resolveShownSurface({
        claim: { kind: 'workspace', ownerKey: 'other' },
        ownerKey: OWNER,
        workspaceSurface: { kind: 'browser', previewId: 'p' },
        workspacePanelOpen: true,
      }).open,
    ).toBe(false)
  })
})
