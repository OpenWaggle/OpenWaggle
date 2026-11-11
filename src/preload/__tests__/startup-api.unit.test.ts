import { afterEach, describe, expect, it, vi } from 'vitest'

const passed = vi.hoisted(() => ({ rendererArguments: new Array<string>() }))

vi.mock('../transport', async () =>
  (await import('./fake-preload-transport')).fakePreloadTransport(() => passed.rendererArguments),
)

async function startupApiWithArgv(argv: readonly string[]) {
  passed.rendererArguments = [...argv]
  vi.resetModules()
  const { startupApi } = await import('../startup-api')
  return startupApi
}

describe('startupApi.getHomeDirectory', () => {
  afterEach(() => {
    passed.rendererArguments = []
  })

  it('returns the home directory main passed in the renderer arguments', async () => {
    const startupApi = await startupApiWithArgv([
      '--openwaggle-home-directory=/private/tmp/shots/home',
    ])
    expect(startupApi.getHomeDirectory()).toBe('/private/tmp/shots/home')
  })

  it('returns null when main passed no home directory', async () => {
    const startupApi = await startupApiWithArgv([])
    expect(startupApi.getHomeDirectory()).toBeNull()
  })
})

describe('startupApi.getTrustedOriginBases', () => {
  afterEach(() => {
    passed.rendererArguments = []
  })

  it('returns the extension runtime base main passed', async () => {
    const base = 'http://127.0.0.1:49152/c2VjcmV0LWNhcGFiaWxpdHktcGF0aA'
    const startupApi = await startupApiWithArgv([`--openwaggle-extension-runtime-base=${base}`])
    expect(startupApi.getTrustedOriginBases()).toEqual({ extensionRuntime: base })
  })

  it.each([
    [[]],
    [['--openwaggle-extension-runtime-base=']],
    [['--openwaggle-extension-runtime-base=runtime']],
  ])('throws when main passed no usable base (%j)', async (argv) => {
    const startupApi = await startupApiWithArgv(argv)
    expect(() => startupApi.getTrustedOriginBases()).toThrow(
      'The main process passed this window no trusted origin bases.',
    )
  })
})
