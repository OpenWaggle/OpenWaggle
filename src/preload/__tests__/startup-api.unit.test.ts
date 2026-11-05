import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  ipcRenderer: { invoke: vi.fn(), on: vi.fn(), removeListener: vi.fn() },
  webUtils: { getPathForFile: vi.fn() },
}))

const originalArgv = process.argv

async function startupApiWithArgv(argv: readonly string[]) {
  process.argv = [...argv]
  vi.resetModules()
  const { startupApi } = await import('../startup-api')
  return startupApi
}

describe('startupApi.getHomeDirectory', () => {
  afterEach(() => {
    process.argv = originalArgv
  })

  it('returns the home directory main passed in the renderer arguments', async () => {
    const startupApi = await startupApiWithArgv([
      '/Applications/OpenWaggle.app',
      '--type=renderer',
      '--openwaggle-home-directory=/private/tmp/shots/home',
    ])
    expect(startupApi.getHomeDirectory()).toBe('/private/tmp/shots/home')
  })

  it('returns null when main passed no home directory', async () => {
    const startupApi = await startupApiWithArgv(['/Applications/OpenWaggle.app', '--type=renderer'])
    expect(startupApi.getHomeDirectory()).toBeNull()
  })
})
