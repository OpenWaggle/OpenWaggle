import { beforeEach, describe, expect, it } from 'vitest'
import { beginWorkspaceOwnerHandoff } from '@/shared/lib/workspace-owner-handoff'
import { useUIStore } from '../ui-store'
import { newWorkspaceBrowser } from '../workspace-panel-actions'
import { useWorkspacePanelStore } from '../workspace-panel-store'

describe('workspace browser handoff admission', () => {
  beforeEach(() => useWorkspacePanelStore.setState({ groups: {} }))

  it('refuses browser creation and materialization for both owners without changing their original tabs', () => {
    const store = useWorkspacePanelStore.getState()
    const source = 'draft:/repo'
    const target = 'session-created'
    const launcher = store.newBrowser(source, 'default')
    const original = useWorkspacePanelStore.getState().groups[source]
    const release = beginWorkspaceOwnerHandoff(source, target)
    try {
      expect(() => store.newBrowser(source)).toThrow('tabs are moving')
      expect(() => store.openBrowser(target, 'https://example.com/')).toThrow('tabs are moving')
      expect(() =>
        store.upsertBrowserRequest({
          requestId: 'blocked-agent-request',
          generation: 1,
          ownerKey: source,
          previewId: 'blocked-agent-preview',
          profileId: 'default',
          url: 'https://example.com/',
          visible: false,
          activate: false,
        }),
      ).toThrow('tabs are moving')
      expect(() =>
        store.materializeBrowser(source, launcher.previewId, 'https://example.com/', 'default'),
      ).toThrow('tabs are moving')
      expect(useWorkspacePanelStore.getState().groups[source]).toBe(original)
      expect(useWorkspacePanelStore.getState().groups[target]).toBeUndefined()
      expect(store.newBrowser('unrelated-session').previewId).toBeTruthy()
      expect(newWorkspaceBrowser(source)).toBe(false)
      expect(useUIStore.getState().toastMessage).toContain('tabs are moving')
    } finally {
      release()
    }
    expect(store.newBrowser(source).previewId).toBeTruthy()
  })
})
