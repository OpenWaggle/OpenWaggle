import { describe, expect, it } from 'vitest'
import { runtimeKeyOf, terminalSidePanelLayoutKey } from '../../lib/terminal-owner'
import {
  TERMINAL_STORE_OWNER as OWNER,
  resetTerminalStore,
  terminalStore as store,
} from './terminal-store-test-harness'

const PREVIEW = { host: '127.0.0.1', port: 5173, url: 'http://127.0.0.1:5173/' }

describe('terminal store owner lifecycle', () => {
  it('atomically migrates draft layout and runtime state to the born session', () => {
    resetTerminalStore()
    const draftOwner = 'draft:/repo'
    const terminalId = store().createTerminal(draftOwner, '/repo')
    if (terminalId === null) throw new Error('Expected draft terminal')
    store().setPanelOpen(draftOwner, true)
    store().applyRuntimeEvent(draftOwner, terminalId, { type: 'activity', processName: 'vite' })
    store().applyRuntimeEvent(draftOwner, terminalId, {
      type: 'port-previews',
      previews: [PREVIEW],
    })

    store().migrateGroup(draftOwner, 'session-1')

    expect(store().groups[draftOwner]).toBeUndefined()
    expect(store().groups['session-1']?.tabs[0]?.panes[0]).toEqual({ terminalId, cwd: '/repo' })
    expect(store().groups['session-1']?.panelOpen).toBe(true)
    expect(store().activity[runtimeKeyOf('session-1', terminalId)]).toBe('vite')
    expect(store().portPreviews[runtimeKeyOf('session-1', terminalId)]).toEqual([PREVIEW])
    expect(store().activity[runtimeKeyOf(draftOwner, terminalId)]).toBeUndefined()
  })

  it('rekeys runtime state for draft terminals held in the side-panel layout', () => {
    resetTerminalStore()
    const draftOwner = 'draft:/repo'
    const sessionOwner = 'session-1'
    const draftSideOwner = terminalSidePanelLayoutKey(draftOwner)
    const sessionSideOwner = terminalSidePanelLayoutKey(sessionOwner)
    const terminalId = store().createTerminal(draftSideOwner, '/repo')
    if (terminalId === null) throw new Error('Expected draft side terminal')
    store().applyRuntimeEvent(draftOwner, terminalId, { type: 'activity', processName: 'vite' })
    store().applyRuntimeEvent(draftOwner, terminalId, {
      type: 'port-previews',
      previews: [PREVIEW],
    })
    store().applyRuntimeEvent(draftOwner, terminalId, { type: 'exited', exitCode: 7 })

    store().rekeyRuntimeMetadata(draftOwner, sessionOwner, [terminalId])
    store().migrateGroup(draftSideOwner, sessionSideOwner)

    expect(store().groups[draftSideOwner]).toBeUndefined()
    expect(store().groups[sessionSideOwner]?.tabs[0]?.panes[0]?.terminalId).toBe(terminalId)
    expect(store().activity[runtimeKeyOf(sessionOwner, terminalId)]).toBe('vite')
    expect(store().portPreviews[runtimeKeyOf(sessionOwner, terminalId)]).toEqual([PREVIEW])
    expect(store().exits[runtimeKeyOf(sessionOwner, terminalId)]).toBe(7)
    expect(store().activity[runtimeKeyOf(draftOwner, terminalId)]).toBeUndefined()
    expect(store().portPreviews[runtimeKeyOf(draftOwner, terminalId)]).toBeUndefined()
    expect(store().exits[runtimeKeyOf(draftOwner, terminalId)]).toBeUndefined()
  })

  it('removes base and side layouts plus all runtime metadata for a session owner', () => {
    resetTerminalStore()
    const sideOwner = terminalSidePanelLayoutKey(OWNER)
    const baseTerminalId = store().createTerminal(OWNER, '/repo')
    const sideTerminalId = store().createTerminal(sideOwner, '/repo')
    if (baseTerminalId === null || sideTerminalId === null) {
      throw new Error('Expected base and side terminals')
    }
    for (const terminalId of [baseTerminalId, sideTerminalId]) {
      store().applyRuntimeEvent(OWNER, terminalId, { type: 'activity', processName: 'node' })
      store().applyRuntimeEvent(OWNER, terminalId, {
        type: 'port-previews',
        previews: [{ host: 'localhost', port: 3000, url: 'http://localhost:3000/' }],
      })
      store().applyRuntimeEvent(OWNER, terminalId, { type: 'exited', exitCode: 2 })
    }
    store().applyRuntimeEvent('other-owner', 'other-terminal', {
      type: 'activity',
      processName: 'keep-me',
    })
    store().applyRuntimeEvent(OWNER, 'orphaned-terminal', {
      type: 'activity',
      processName: 'remove-me',
    })
    store().applyRuntimeEvent(OWNER, 'orphaned-terminal', {
      type: 'port-previews',
      previews: [{ host: 'localhost', port: 9999, url: 'http://localhost:9999/' }],
    })
    store().applyRuntimeEvent(OWNER, 'orphaned-terminal', { type: 'exited', exitCode: 9 })

    store().removeOwner(OWNER)

    expect(store().groups[OWNER]).toBeUndefined()
    expect(store().groups[sideOwner]).toBeUndefined()
    for (const terminalId of [baseTerminalId, sideTerminalId]) {
      expect(store().activity[runtimeKeyOf(OWNER, terminalId)]).toBeUndefined()
      expect(store().portPreviews[runtimeKeyOf(OWNER, terminalId)]).toBeUndefined()
      expect(store().exits[runtimeKeyOf(OWNER, terminalId)]).toBeUndefined()
    }
    expect(store().activity[runtimeKeyOf(OWNER, 'orphaned-terminal')]).toBeUndefined()
    expect(store().portPreviews[runtimeKeyOf(OWNER, 'orphaned-terminal')]).toBeUndefined()
    expect(store().exits[runtimeKeyOf(OWNER, 'orphaned-terminal')]).toBeUndefined()
    expect(store().activity[runtimeKeyOf('other-owner', 'other-terminal')]).toBe('keep-me')
  })
})
