import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { applicationCliArguments } from '../application-cli-arguments'
import { routeTopLevelCli } from '../top-level-cli-route'

const DEVELOPMENT_APP = path.resolve('/workspace/OpenWaggle')

/** Bun's argv: the runtime, the script it runs, then the application's arguments. */
const PACKAGED = [
  '/Applications/OpenWaggle.app/Contents/MacOS/bun',
  '/Applications/OpenWaggle.app/Contents/Resources/main.js',
]
const DEVELOPMENT = ['/usr/local/bin/bun', `${DEVELOPMENT_APP}/out/main/boot.js`]

function launch(args: readonly string[], isPackaged: boolean) {
  const argv = [...(isPackaged ? PACKAGED : DEVELOPMENT), ...args]
  return routeTopLevelCli(applicationCliArguments(argv), {
    workingDirectory: DEVELOPMENT_APP,
    homeDirectory: path.resolve('/home/ada'),
    pathKind: (absolutePath) => (absolutePath === DEVELOPMENT_APP ? 'directory' : 'missing'),
    isPackaged,
  })
}

describe('real launch shapes', () => {
  it.each([
    // The Electrobun launcher starts the Hutch entry with no arguments of its own.
    ['Finder, Dock, open -a and the launcher', []],
    ['the Windows command shim without a command', ['--']],
    [
      'the automation lock-denied probe',
      ['--openwaggle-automation-single-instance-lock-denied-marker=/tmp/marker'],
    ],
  ])('opens the packaged desktop app for %s', (_label, args) => {
    expect(launch(args, true)).toEqual({ kind: 'gui' })
  })

  it.each([
    ['bun run dev', []],
    ['startup measurement', ['--openwaggle-startup-timings']],
  ])('opens the development desktop app for %s', (_label, args) => {
    expect(launch(args, false)).toEqual({ kind: 'gui' })
  })

  it.each([
    // A background process hands a link on with `-- <link>`.
    ['a forwarded launch', ['--', 'openwaggle://sessions/s-1']],
    // The protocol registration runs the app with the link as its argument.
    ['a protocol launch', ['openwaggle://sessions/s-1']],
  ])('opens the Session a link names for %s', (_label, args) => {
    expect(launch(args, true)).toEqual({
      kind: 'open-session-link',
      link: 'openwaggle://sessions/s-1',
    })
  })

  it('routes CLI commands through the shim separator', () => {
    expect(launch(['--', '--help'], true)).toEqual({ kind: 'help' })
    expect(launch(['--', 'hive', 'list'], true)).toEqual({
      kind: 'delegate',
      argv: ['hive', 'list'],
    })
  })

  it('routes the detached Session Host launch in both builds', () => {
    expect(launch(['--no-sandbox', 'session-host-internal'], true)).toEqual({
      kind: 'delegate',
      argv: ['session-host-internal'],
    })
    expect(launch(['session-host-internal'], false)).toEqual({
      kind: 'delegate',
      argv: ['session-host-internal'],
    })
  })

  it('reports a packaged typo instead of opening the app', () => {
    expect(launch(['hvie', 'list'], true)).toEqual({
      kind: 'usage-error',
      message: "unknown command 'hvie'. Did you mean 'hive'?",
    })
  })
})
