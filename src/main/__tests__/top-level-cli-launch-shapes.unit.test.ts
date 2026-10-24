import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { applicationCliArguments } from '../application-cli-arguments'
import { routeTopLevelCli } from '../top-level-cli-route'

const DEVELOPMENT_APP = path.resolve('/workspace/OpenWaggle')

function launch(argv: readonly string[], isPackaged: boolean) {
  return routeTopLevelCli(applicationCliArguments(argv, { isPackaged }), {
    workingDirectory: DEVELOPMENT_APP,
    homeDirectory: path.resolve('/home/ada'),
    pathKind: (absolutePath) => (absolutePath === DEVELOPMENT_APP ? 'directory' : 'missing'),
    isPackaged,
  })
}

describe('real launch shapes', () => {
  it.each([
    ['Finder, Dock, and open -a', ['/Applications/OpenWaggle.app/Contents/MacOS/OpenWaggle']],
    ['the Windows command shim without a command', ['C:\\OpenWaggle\\OpenWaggle.exe', '--']],
    ['the NSIS updater relaunch', ['C:\\OpenWaggle\\OpenWaggle.exe', '--updated']],
    ['a Linux sandbox prefix', ['/opt/OpenWaggle/openwaggle', '--no-sandbox']],
    [
      'the automation lock-denied probe',
      [
        '/opt/OpenWaggle/openwaggle',
        '--no-sandbox',
        '--openwaggle-automation-single-instance-lock-denied-marker=/tmp/marker',
      ],
    ],
    ['packaged CDP QA', ['/opt/OpenWaggle/openwaggle', '--remote-debugging-port=9222']],
  ])('opens the packaged desktop app for %s', (_label, argv) => {
    expect(launch(argv, true)).toEqual({ kind: 'gui' })
  })

  it.each([
    ['electron-vite dev', ['/electron', '.']],
    [
      'dev:debug and startup measurement',
      ['/electron', '.', '--remote-debugging-port=9223', '--openwaggle-startup-timings'],
    ],
    ['Playwright', ['/electron', '--inspect=0', '--remote-debugging-port=0', '.']],
    ['a Linux Playwright launch', ['/electron', '--no-sandbox', '--inspect=0', DEVELOPMENT_APP]],
  ])('opens the development desktop app for %s', (_label, argv) => {
    expect(launch(argv, false)).toEqual({ kind: 'gui' })
  })

  it.each([
    // A background process hands a macOS link on with `open -n -a <bundle> --args -- <link>`.
    [
      'a macOS forwarded launch',
      ['/Applications/OpenWaggle.app/Contents/MacOS/OpenWaggle', '--', 'openwaggle://sessions/s-1'],
    ],
    // setAsDefaultProtocolClient registers `"OpenWaggle.exe" "%1"`.
    ['a Windows protocol launch', ['C:\\OpenWaggle\\OpenWaggle.exe', 'openwaggle://sessions/s-1']],
    // The desktop entry scripts/install.sh writes runs `Exec=<AppImage> %U`.
    [
      'a Linux desktop-entry launch',
      ['/home/ada/.local/bin/OpenWaggle.AppImage', 'openwaggle://sessions/s-1'],
    ],
    // An AppImage integrated through its own entry runs `AppRun --no-sandbox %U`.
    [
      'an integrated AppImage launch',
      ['/opt/OpenWaggle/openwaggle', '--no-sandbox', 'openwaggle://sessions/s-1'],
    ],
  ])('opens the Session a link names for %s', (_label, argv) => {
    expect(launch(argv, true)).toEqual({
      kind: 'open-session-link',
      link: 'openwaggle://sessions/s-1',
    })
  })

  it('routes CLI commands through the Windows shim separator', () => {
    expect(launch(['C:\\OpenWaggle\\OpenWaggle.exe', '--', '--help'], true)).toEqual({
      kind: 'help',
    })
    expect(launch(['C:\\OpenWaggle\\OpenWaggle.exe', '--', 'hive', 'list'], true)).toEqual({
      kind: 'delegate',
      argv: ['hive', 'list'],
    })
  })

  it('routes the detached Session Host launch in both builds', () => {
    expect(
      launch(['/opt/OpenWaggle/openwaggle', '--no-sandbox', 'session-host-internal'], true),
    ).toEqual({ kind: 'delegate', argv: ['session-host-internal'] })
    expect(launch(['/electron', DEVELOPMENT_APP, 'session-host-internal'], false)).toEqual({
      kind: 'delegate',
      argv: ['session-host-internal'],
    })
  })

  it('reports a packaged typo instead of opening the app', () => {
    expect(launch(['/opt/OpenWaggle/openwaggle', 'hvie', 'list'], true)).toEqual({
      kind: 'usage-error',
      message: "unknown command 'hvie'. Did you mean 'hive'?",
    })
  })
})
