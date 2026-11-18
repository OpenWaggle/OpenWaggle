import { beforeEach, describe, expect, it, vi } from 'vitest'

const startDesktopShellEnvironment = vi.hoisted(() =>
  vi.fn(() => ({ ready: Promise.resolve(), refreshed: Promise.resolve(), fromCache: false })),
)
vi.mock('../desktop-shell-environment-start', () => ({ startDesktopShellEnvironment }))

async function processModule() {
  vi.resetModules()
  return import('../desktop-shell-environment-process')
}

beforeEach(() => {
  startDesktopShellEnvironment.mockClear()
})

describe("this process's login-shell hydration", () => {
  it('marks the desktop app, which writes the cache, as the refresher a Host can wait for', async () => {
    const { desktopShellEnvironmentRefreshStartedAt, installProcessDesktopShellEnvironment } =
      await processModule()
    expect(desktopShellEnvironmentRefreshStartedAt()).toBeNull()

    const before = Date.now()
    installProcessDesktopShellEnvironment({}, { cacheFile: '/profile/shell-environment.json' })

    expect(desktopShellEnvironmentRefreshStartedAt()).toBeGreaterThanOrEqual(before)
    expect(startDesktopShellEnvironment).toHaveBeenCalledWith(
      expect.objectContaining({ writeCache: true }),
    )
  })

  it("never marks a Host, which only reads the cache and waits for the app's refresh", async () => {
    const { desktopShellEnvironmentRefreshStartedAt, installProcessDesktopShellEnvironment } =
      await processModule()

    installProcessDesktopShellEnvironment(
      {},
      {
        cacheFile: '/profile/shell-environment.json',
        writeCache: false,
        refreshedElsewhereSince: 1_800_000_000_000,
      },
    )

    expect(desktopShellEnvironmentRefreshStartedAt()).toBeNull()
    expect(startDesktopShellEnvironment).toHaveBeenCalledWith(
      expect.objectContaining({
        writeCache: false,
        refreshedElsewhere: expect.objectContaining({ since: 1_800_000_000_000 }),
      }),
    )
  })
})
