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

  it('routes CLI commands through the Windows shim separator', () => {
    expect(launch(['C:\\OpenWaggle\\OpenWaggle.exe', '--', '--help'], true)).toEqual({
      kind: 'help',
    })
    expect(launch(['C:\\OpenWaggle\\OpenWaggle.exe', '--', 'sessions', 'list'], true)).toEqual({
      kind: 'delegate',
      argv: ['sessions', 'list'],
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
    expect(launch(['/opt/OpenWaggle/openwaggle', 'sesions', 'list'], true)).toEqual({
      kind: 'usage-error',
      message: "unknown command 'sesions'. Did you mean 'sessions'?",
    })
  })
})
