import { describe, expect, it } from 'vitest'
import {
  piUserAppSettings,
  withOpenWagglePiAppSettings,
} from '../openwaggle-pi-settings-app-overlay'

const settings = (value: object) => JSON.stringify(value)

describe("the user's own Pi values for OpenWaggle's settings", () => {
  it('reads cache warming and an explicit codemode choice from the global Pi settings', () => {
    expect(
      piUserAppSettings(settings({ cacheWarming: 'idle', defaultTools: ['-codemode'] })),
    ).toEqual({ cacheWarming: 'idle', codemodeEnabled: false })
    expect(piUserAppSettings(settings({ defaultTools: ['+codemode'] }))).toEqual({
      codemodeEnabled: true,
    })
    expect(piUserAppSettings(settings({ defaultTools: ['read', 'codemode'] }))).toEqual({
      codemodeEnabled: true,
    })
  })

  it('has no codemode value when the Pi settings never name codemode', () => {
    expect(piUserAppSettings(settings({ defaultTools: ['read', 'bash'] }))).toEqual({})
    expect(piUserAppSettings(settings({ theme: 'dark' }))).toEqual({})
    expect(piUserAppSettings(undefined)).toEqual({})
  })

  it('ignores values Pi would not accept', () => {
    expect(piUserAppSettings(settings({ cacheWarming: 'always' }))).toEqual({})
    expect(piUserAppSettings('not json')).toEqual({})
  })
})

describe("OpenWaggle's settings in the Pi settings Pi reads", () => {
  it("turns codemode on or off after the user's own Pi entries, so OpenWaggle's choice wins", () => {
    const stored = settings({ defaultTools: ['-codemode'], cacheWarming: 'idle' })

    expect(
      JSON.parse(
        withOpenWagglePiAppSettings(stored, { codemodeEnabled: true, cacheWarming: 'off' }),
      ),
    ).toEqual({ defaultTools: ['-codemode', '+codemode'], cacheWarming: 'off' })
    expect(
      JSON.parse(
        withOpenWagglePiAppSettings(settings({ defaultTools: ['+codemode'] }), {
          codemodeEnabled: false,
          cacheWarming: 'streaming',
        }),
      ),
    ).toEqual({ defaultTools: ['+codemode', '-codemode'], cacheWarming: 'streaming' })
  })
})
