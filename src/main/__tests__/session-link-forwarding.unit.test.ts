import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  launch: vi.fn(async (_command: string, _args: readonly string[]) => undefined),
}))

vi.mock('../desktop-ui', () => ({
  isAutomationMode: () => false,
  launchExternalApplication: mocks.launch,
}))

const { desktopAppLaunchArguments, forwardSessionLinksFromBackgroundProcess } = await import(
  '../session-link-forwarding'
)

beforeEach(() => mocks.launch.mockClear())

describe('desktopAppLaunchArguments', () => {
  it('starts a new desktop app instance with the link as a launch argument', () => {
    expect(
      desktopAppLaunchArguments(
        '/Applications/OpenWaggle.app/Contents/MacOS/OpenWaggle',
        'openwaggle://sessions/s-1',
      ),
    ).toEqual([
      '-n',
      '-a',
      '/Applications/OpenWaggle.app',
      '--args',
      '--',
      'openwaggle://sessions/s-1',
    ])
  })
})

describe('forwardSessionLinksFromBackgroundProcess', () => {
  it('launches the desktop app through open for a delivered Session link only', () => {
    let deliver: ((url: string) => void) | undefined
    forwardSessionLinksFromBackgroundProcess(
      {
        isPackaged: true,
        on: (_event, listener) => {
          deliver = (url) => listener({ preventDefault: vi.fn() }, url)
        },
      },
      { platform: 'darwin', channel: 'stable' },
    )

    deliver?.('openwaggle://sessions/s-1')
    deliver?.('openwaggle://app/index.html')

    expect(mocks.launch).toHaveBeenCalledExactlyOnceWith(
      'open',
      desktopAppLaunchArguments(process.execPath, 'openwaggle://sessions/s-1'),
    )
  })
})
