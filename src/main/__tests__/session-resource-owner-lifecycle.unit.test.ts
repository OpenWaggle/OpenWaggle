import { EventEmitter } from 'node:events'
import { SessionId } from '@shared/types/brand'
import { fromPartial } from '@total-typescript/shoehorn'
import type { WebContents } from 'electron'
import { describe, expect, it, vi } from 'vitest'
import {
  activateSessionResourceContentOwner,
  beginSessionResourceContentRequest,
  monitorSessionResourceContentOwner,
} from '../session-resource-owner-lifecycle'

describe('Session resource capability owner lifecycle', () => {
  it('purges capabilities on document replacement, renderer loss, and destruction', () => {
    const sender = Object.assign(new EventEmitter(), { id: 41 })
    const webContents = fromPartial<WebContents>(sender)
    const purge = vi.fn()

    monitorSessionResourceContentOwner(webContents, purge)
    monitorSessionResourceContentOwner(webContents, purge)
    expect(sender.listenerCount('did-start-navigation')).toBe(1)

    sender.emit('did-start-navigation', { isMainFrame: true, isSameDocument: true })
    expect(purge).not.toHaveBeenCalled()
    sender.emit('did-start-navigation', {
      isMainFrame: true,
      isSameDocument: false,
      url: 'https://example.com/',
    })
    expect(purge).toHaveBeenCalledExactlyOnceWith(41)

    sender.emit('render-process-gone')
    expect(purge).toHaveBeenCalledTimes(2)
    expect(sender.listenerCount('did-start-navigation')).toBe(0)

    const replacement = Object.assign(new EventEmitter(), { id: 42 })
    const replacementContents = fromPartial<WebContents>(replacement)
    monitorSessionResourceContentOwner(replacementContents, purge)
    replacement.emit('destroyed')
    expect(purge).toHaveBeenLastCalledWith(42)
    expect(replacement.listenerCount('did-start-navigation')).toBe(0)
  })

  it('invalidates stale Session reads and in-flight reads across navigation', () => {
    const sender = Object.assign(new EventEmitter(), { id: 73 })
    const webContents = fromPartial<WebContents>(sender)

    const sessionA = beginSessionResourceContentRequest(webContents, SessionId('session-a'))
    const sessionAParallel = beginSessionResourceContentRequest(webContents, SessionId('session-a'))
    expect(sessionA.isCurrent()).toBe(true)
    expect(sessionAParallel.isCurrent()).toBe(true)

    const sessionB = beginSessionResourceContentRequest(webContents, SessionId('session-b'))
    expect(sessionA.isCurrent()).toBe(false)
    expect(sessionAParallel.isCurrent()).toBe(false)
    expect(sessionB.isCurrent()).toBe(true)

    sender.emit('did-start-navigation', {
      isMainFrame: true,
      isSameDocument: false,
      url: 'https://example.com/',
    })
    expect(sessionB.isCurrent()).toBe(false)
  })

  it('revokes the prior Session when the displayed route changes without another resource read', () => {
    const sender = Object.assign(new EventEmitter(), { id: 74 })
    const webContents = fromPartial<WebContents>(sender)
    const purge = vi.fn()
    monitorSessionResourceContentOwner(webContents, purge)

    activateSessionResourceContentOwner(webContents, SessionId('session-a'))
    const sessionA = beginSessionResourceContentRequest(webContents, SessionId('session-a'))
    activateSessionResourceContentOwner(webContents, SessionId('session-b'))

    expect(sessionA.isCurrent()).toBe(false)
    expect(purge).toHaveBeenCalledWith(74)
    expect(
      beginSessionResourceContentRequest(webContents, SessionId('session-a')).isCurrent(),
    ).toBe(false)

    const sessionB = beginSessionResourceContentRequest(webContents, SessionId('session-b'))
    activateSessionResourceContentOwner(webContents, null)
    expect(sessionB.isCurrent()).toBe(false)
    expect(
      beginSessionResourceContentRequest(webContents, SessionId('session-a')).isCurrent(),
    ).toBe(false)
  })
})
