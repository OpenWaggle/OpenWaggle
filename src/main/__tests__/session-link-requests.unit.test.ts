import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ broadcast: vi.fn() }))

vi.mock('../utils/broadcast', () => ({ broadcastToWindows: mocks.broadcast }))

const { requestOpenSessionLink, takeOpenSessionLinkRequest } = await import(
  '../session-link-requests'
)

beforeEach(() => {
  while (takeOpenSessionLinkRequest() !== null) {
    // Drain requests left by an earlier test.
  }
  mocks.broadcast.mockClear()
})

describe('Session link requests', () => {
  it('holds the Session identity until a renderer takes it', () => {
    expect(requestOpenSessionLink('openwaggle://sessions/session-1')).toBe(true)

    expect(mocks.broadcast).toHaveBeenCalledWith('app:open-session-link-requested', null)
    expect(takeOpenSessionLinkRequest()).toBe('session-1')
    expect(takeOpenSessionLinkRequest()).toBeNull()
  })

  it('hands out waiting links oldest first without repeating a link opened twice', () => {
    requestOpenSessionLink('openwaggle://sessions/session-1')
    requestOpenSessionLink('openwaggle://sessions/session-1/')
    requestOpenSessionLink('openwaggle://sessions/session-2')

    expect(takeOpenSessionLinkRequest()).toBe('session-1')
    expect(takeOpenSessionLinkRequest()).toBe('session-2')
    expect(takeOpenSessionLinkRequest()).toBeNull()
  })

  it('keeps only the newest few links while no renderer takes them', () => {
    for (let index = 0; index < 10; index += 1) {
      requestOpenSessionLink(`openwaggle://sessions/session-${String(index)}`)
    }

    const taken: string[] = []
    for (let id = takeOpenSessionLinkRequest(); id !== null; id = takeOpenSessionLinkRequest()) {
      taken.push(id)
    }
    expect(taken).toEqual([2, 3, 4, 5, 6, 7, 8, 9].map((index) => `session-${String(index)}`))
  })

  it.each([
    'openwaggle://app/index.html',
    'openwaggle://sessions/session-1?prompt=run',
    'openwaggle://sessions/session-1/items',
    'https://example.com/',
  ])('refuses %s without telling any renderer', (url) => {
    expect(requestOpenSessionLink(url)).toBe(false)

    expect(mocks.broadcast).not.toHaveBeenCalled()
    expect(takeOpenSessionLinkRequest()).toBeNull()
  })
})
