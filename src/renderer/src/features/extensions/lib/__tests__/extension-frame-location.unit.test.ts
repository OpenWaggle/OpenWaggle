import { describe, expect, it } from 'vitest'
import { extensionFrameIdFromPath } from '../extension-frame-location'

describe('extensionFrameIdFromPath', () => {
  it.each([
    ['Electron', '/frames/%3Ar1%3A/index.html'],
    ['Electrobun', '/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/frames/%3Ar1%3A/index.html'],
  ])('reads the frame id of a %s frame document', (_shell, pathname) => {
    expect(extensionFrameIdFromPath(pathname)).toBe(':r1:')
  })

  it.each(['/frames/index.html', '/other/r1/index.html', '/frames/r1/bootstrap.js', '/'])(
    'rejects %s, which is no frame document',
    (pathname) => {
      expect(() => extensionFrameIdFromPath(pathname)).toThrow(
        'Invalid OpenWaggle extension frame URL.',
      )
    },
  )

  it('rejects a frame id that does not decode', () => {
    expect(() => extensionFrameIdFromPath('/frames/%E0%A4%A/index.html')).toThrow(
      'Invalid OpenWaggle extension frame id',
    )
  })
})
