import { describe, expect, it } from 'vitest'
import { beginWorkspaceOwnerHandoff } from '@/shared/lib/workspace-owner-handoff'
import { resetTerminalStore, terminalStore as store } from './terminal-store-test-harness'

describe('terminal owner handoff admission', () => {
  it.each([true, false])(
    'reconciles deferred native terminals at the canonical owner when committed=%s',
    (committed) => {
      resetTerminalStore()
      const source = 'draft:/reconcile'
      const target = 'session-reconcile'
      const release = beginWorkspaceOwnerHandoff(source, target)
      store().ensureTerminal(`side-panel:${source}`, 'source-runtime', '/repo')
      store().ensureTerminal(target, 'destination-setup', '/repo')
      release(committed)
      const expectedSourceLayout = `side-panel:${committed ? target : source}`
      expect(store().groups[expectedSourceLayout]?.tabs[0]?.panes[0]?.terminalId).toBe(
        'source-runtime',
      )
      expect(store().groups[`side-panel:${committed ? source : target}`]).toBeUndefined()
      expect(store().groups[target]?.tabs[0]?.panes[0]?.terminalId).toBe('destination-setup')
    },
  )

  it('preserves captured tabs against source and destination creation while other owners remain usable', () => {
    resetTerminalStore()
    const source = 'draft:/repo'
    const target = 'session-created'
    store().createTerminal(source, '/repo')
    const tabId = store().groups[source]?.activeTabId
    if (!tabId) throw new Error('Expected source tab')
    const sourceGroup = store().groups[source]
    const release = beginWorkspaceOwnerHandoff(source, target)
    try {
      expect(store().createTerminal(source, '/repo')).toBeNull()
      expect(store().createTerminal(target, '/repo')).toBeNull()
      expect(store().createTerminal(`side-panel:${source}`, '/repo')).toBeNull()
      expect(store().splitTerminal(source, tabId, '/repo')).toBeNull()
      store().ensureTerminal(target, 'late-setup', '/repo')
      store().moveTab(source, 'unrelated-session', tabId)
      store().moveAllTabs(source, `side-panel:${source}`)
      expect(store().groups[source]).toBe(sourceGroup)
      expect(store().groups[target]).toBeUndefined()
      expect(store().groups[`side-panel:${source}`]).toBeUndefined()
      expect(store().createTerminal('unrelated-session', '/repo')).not.toBeNull()
    } finally {
      release()
    }
    expect(store().groups[target]?.tabs[0]?.panes[0]?.terminalId).toBe('late-setup')
    expect(store().createTerminal(source, '/repo')).not.toBeNull()
    expect(store().createTerminal(target, '/repo')).not.toBeNull()
  })
})
