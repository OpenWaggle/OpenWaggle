import { EventEmitter } from 'node:events'
import { fromPartial } from '@total-typescript/shoehorn'
import type { WebContents } from 'electron'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  env: { ELECTRON_RENDERER_URL: 'http://localhost:5173' },
  download: vi.fn(() => false),
  openExternal: vi.fn(async () => undefined),
}))
vi.mock('../env', () => ({ env: mocks.env }))
vi.mock('../desktop-ui', () => ({ openExternal: mocks.openExternal }))
vi.mock('../session-resource-protocol', () => ({
  isSessionResourceDownloadNavigation: mocks.download,
}))

import { installExternalNavigationGuard } from '../external-navigation'

function navigate(url: string) {
  const events = new EventEmitter()
  const on = vi.fn<WebContents['on']>().mockImplementation((event, listener) => {
    events.on(event, listener)
    return contents
  })
  const contents = fromPartial<WebContents>({
    id: 7,
    on,
    setWindowOpenHandler: vi.fn(),
    getURL: () => 'openwaggle://app/',
  })
  installExternalNavigationGuard(contents)
  expect(events.listenerCount('will-navigate')).toBe(1)
  const preventDefault = vi.fn()
  events.emit('will-navigate', { preventDefault }, url)
  return preventDefault
}

describe('merged renderer navigation boundary', () => {
  beforeEach(() => vi.clearAllMocks())

  it.each(['http://localhost:51730/', 'openwaggle://app.attacker.invalid/'])(
    'blocks lookalike renderer origin %s',
    (url) => {
      const preventDefault = navigate(url)
      expect(preventDefault).toHaveBeenCalled()
      expect(mocks.openExternal).toHaveBeenCalledWith(url)
    },
  )

  it.each(['http://localhost:5173/?reload=1', 'openwaggle://app/sessions/one'])(
    'retains trusted renderer navigation %s',
    (url) => {
      expect(navigate(url)).not.toHaveBeenCalled()
      expect(mocks.openExternal).not.toHaveBeenCalled()
    },
  )

  it('retains the session-owned download capability exception', () => {
    mocks.download.mockReturnValueOnce(true)
    expect(navigate('openwaggle-resource://download/opaque')).not.toHaveBeenCalled()
    expect(mocks.download).toHaveBeenCalledWith(
      'openwaggle-resource://download/opaque',
      7,
      'openwaggle://app/',
    )
    expect(mocks.openExternal).not.toHaveBeenCalled()
  })
})
