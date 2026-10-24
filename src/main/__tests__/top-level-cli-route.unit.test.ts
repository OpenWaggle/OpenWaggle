import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { editDistance } from '../top-level-cli-edit-distance'
import {
  type CliPathKind,
  routeTopLevelCli,
  suggestTopLevelCommand,
  type TopLevelCliEnvironment,
} from '../top-level-cli-route'

const WORKING_DIRECTORY = path.resolve('/work/project')
const HOME_DIRECTORY = path.resolve('/home/ada')

function environment(
  paths: Readonly<Record<string, CliPathKind>> = {},
  isPackaged = false,
): TopLevelCliEnvironment {
  return {
    workingDirectory: WORKING_DIRECTORY,
    homeDirectory: HOME_DIRECTORY,
    pathKind: (absolutePath) => paths[absolutePath] ?? 'missing',
    isPackaged,
  }
}

function route(argv: readonly string[], paths?: Readonly<Record<string, CliPathKind>>) {
  return routeTopLevelCli(argv, environment(paths))
}

function packagedRoute(argv: readonly string[]) {
  return routeTopLevelCli(argv, environment({}, true))
}

describe('top-level CLI routing', () => {
  it('opens the desktop app when there are no arguments', () => {
    expect(route([])).toEqual({ kind: 'gui' })
  })

  it.each([['help'], ['-h'], ['--help']])('prints top-level help for %s', (token) => {
    expect(route([token])).toEqual({ kind: 'help' })
  })

  it.each([['version'], ['-v'], ['-V'], ['--version']])('prints the version for %s', (token) => {
    expect(route([token])).toEqual({ kind: 'version' })
  })

  it('rejects arguments after a version flag', () => {
    expect(route(['--version', 'extra'])).toMatchObject({ kind: 'usage-error' })
  })

  it('delegates command groups without inspecting their payload', () => {
    const argv = ['hive', 'message', 'id', '--text', '--help']
    expect(route(argv)).toEqual({ kind: 'delegate', argv })
  })

  it.each([
    ['hive', ['hive', 'help']],
    ['mcp', ['mcp', 'help']],
    ['update', ['update', '--help']],
    ['access', ['access']],
  ])('maps "%s --help" and "help %s" to that group help', (group, expected) => {
    expect(route([group, '--help'])).toEqual({ kind: 'delegate', argv: expected })
    expect(route([group, '-h'])).toEqual({ kind: 'delegate', argv: expected })
    expect(route(['help', group])).toEqual({ kind: 'delegate', argv: expected })
  })

  it('routes the internal Session Host command unchanged', () => {
    expect(route(['session-host-internal'])).toEqual({
      kind: 'delegate',
      argv: ['session-host-internal'],
    })
  })

  it('routes run and status to the top-level commands', () => {
    expect(route(['run', 'fix', 'the', 'tests'])).toEqual({
      kind: 'command',
      command: 'run',
      argv: ['fix', 'the', 'tests'],
    })
    expect(route(['status', '--json'])).toEqual({
      kind: 'command',
      command: 'status',
      argv: ['--json'],
    })
    expect(route(['help', 'run'])).toEqual({ kind: 'command', command: 'run', argv: ['--help'] })
  })

  it.each([
    ['hvie', 'hive'],
    ['hiev', 'hive'],
    ['statsu', 'status'],
    ['rnu', 'run'],
    ['updat', 'update'],
    ['agnets', 'agents'],
    ['hiv', 'hive'],
    ['sched', 'schedules'],
  ])('prints help instead of opening the app for the typo %s', (typo, suggestion) => {
    const result = route([typo])
    expect(result).toEqual({
      kind: 'usage-error',
      message: `unknown command '${typo}'. Did you mean '${suggestion}'?`,
    })
  })

  it('suggests the hive group for a bare hive subcommand', () => {
    expect(route(['list'])).toEqual({
      kind: 'usage-error',
      message: "unknown command 'list'. Did you mean 'hive list'?",
    })
  })

  it.each([['sessions', 'list', '--all'], ['sessions'], ['delegations', 'list']])(
    'refuses the former %s group and names hive (ADR 0053)',
    (...argv) => {
      expect(route(argv)).toEqual({
        kind: 'usage-error',
        message: `unknown command '${argv[0]}'. It is now 'hive'.`,
      })
      expect(route(['help', argv[0] ?? ''])).toEqual({
        kind: 'usage-error',
        message: `no help topic '${argv[0]}'.`,
      })
    },
  )

  it('reports an unknown word without a suggestion when nothing is close', () => {
    expect(route(['frobnicate'])).toEqual({
      kind: 'usage-error',
      message: "unknown command 'frobnicate'.",
    })
  })

  it.each([
    ['--hepl'],
    ['--hlep'],
    ['--verison'],
    ['--vresion=1'],
    ['--HELP'],
    ['--Version'],
    ['--h'],
    ['--v'],
    ['--help=all'],
    ['--version=1'],
  ])('treats %s as a mistyped OpenWaggle option', (option) => {
    expect(route([option])).toMatchObject({ kind: 'usage-error' })
  })

  it('suggests the command when one is written as a switch', () => {
    expect(route(['--status'])).toEqual({
      kind: 'usage-error',
      message: "unknown option '--status'. Did you mean 'status'?",
    })
    expect(route(['--hive'])).toMatchObject({ kind: 'usage-error' })
    expect(route(['--updated'])).toEqual({ kind: 'gui' })
  })

  it('rejects an empty argument instead of opening the working directory', () => {
    expect(route([''])).toEqual({ kind: 'usage-error', message: 'empty argument.' })
  })

  it('rejects unknown short options and a stray separator', () => {
    expect(route(['-x'])).toEqual({ kind: 'usage-error', message: "unknown option '-x'." })
    expect(route(['--'])).toMatchObject({ kind: 'usage-error' })
  })

  it('rejects a packaged switch followed by a command word instead of dropping the word', () => {
    expect(packagedRoute(['--json', 'hive', 'list'])).toEqual({
      kind: 'usage-error',
      message: "unknown option '--json' before 'hive'.",
    })
    expect(route(['--inspect=0', '/app'])).toEqual({ kind: 'gui' })
    expect(packagedRoute(['--remote-debugging-port=9222'])).toEqual({ kind: 'gui' })
    expect(packagedRoute(['--updated'])).toEqual({ kind: 'gui' })
    expect(packagedRoute(['--v=1'])).toEqual({ kind: 'gui' })
  })

  it('keeps passing Electron and Chromium switches to the desktop app', () => {
    expect(route(['--remote-debugging-port=9223'])).toEqual({ kind: 'gui' })
    expect(route(['--inspect=0', '--remote-debugging-port=0', '/app/out/main/index.js'])).toEqual({
      kind: 'gui',
    })
    expect(route(['--openwaggle-startup-timings'])).toEqual({ kind: 'gui' })
    expect(route(['-AppleLanguages', '(de)'])).toEqual({ kind: 'gui' })
    expect(route(['-NSDocumentRevisionsDebugMode', 'YES'])).toEqual({ kind: 'gui' })
    expect(route(['-psn_0_12345'])).toEqual({ kind: 'gui' })
    expect(route(['-psn_0_12345', '/Users/ada/notes'])).toEqual({ kind: 'gui' })
  })

  it('opens an existing directory as a project', () => {
    const projectPath = path.join(WORKING_DIRECTORY, 'app')
    expect(route(['app'], { [projectPath]: 'directory' })).toEqual({
      kind: 'open-project',
      projectPath,
    })
    expect(route(['.'], { [WORKING_DIRECTORY]: 'directory' })).toEqual({
      kind: 'open-project',
      projectPath: WORKING_DIRECTORY,
    })
    expect(route(['~/code'], { [path.join(HOME_DIRECTORY, 'code')]: 'directory' })).toEqual({
      kind: 'open-project',
      projectPath: path.join(HOME_DIRECTORY, 'code'),
    })
  })

  it('prefers commands over a same-named directory', () => {
    const shadowing = path.join(WORKING_DIRECTORY, 'hive')
    expect(route(['hive'], { [shadowing]: 'directory' })).toEqual({
      kind: 'delegate',
      argv: ['hive'],
    })
    expect(route(['./hive'], { [shadowing]: 'directory' })).toEqual({
      kind: 'open-project',
      projectPath: shadowing,
    })
  })

  it('rejects files, missing paths, and trailing arguments after a project', () => {
    const file = path.join(WORKING_DIRECTORY, 'README.md')
    const directory = path.join(WORKING_DIRECTORY, 'app')
    expect(route(['README.md', 'extra'], { [file]: 'file' })).toMatchObject({
      kind: 'usage-error',
    })
    expect(route(['./missing'])).toEqual({
      kind: 'usage-error',
      message: "no such directory: './missing'.",
    })
    expect(route(['app', 'extra'], { [directory]: 'directory' })).toMatchObject({
      kind: 'usage-error',
    })
  })

  it('opens the folder of a file named on the command line', () => {
    const file = path.join(WORKING_DIRECTORY, 'README.md')

    expect(route(['README.md'], { [file]: 'file' })).toEqual({
      kind: 'open-project',
      projectPath: WORKING_DIRECTORY,
    })
  })

  it('expands a Windows-style home prefix', () => {
    const code = path.join(HOME_DIRECTORY, 'code')

    expect(route(['~\\code'], { [code]: 'directory' })).toEqual({
      kind: 'open-project',
      projectPath: code,
    })
  })

  it.each([
    ['schedules', ['schedules', 'help']],
    ['agents', ['agents', 'help']],
    ['recovery', ['recovery', 'help']],
  ])('maps help %s to that group help', (group, expected) => {
    expect(route(['help', group])).toEqual({ kind: 'delegate', argv: expected })
  })

  it('routes the host command and treats help and version as help topics', () => {
    expect(route(['host', 'stop', '--wait'])).toEqual({
      kind: 'command',
      command: 'host',
      argv: ['stop', '--wait'],
    })
    expect(route(['help', 'help'])).toEqual({ kind: 'help' })
    expect(route(['help', 'version'])).toEqual({ kind: 'help' })
  })

  it('rejects unknown help topics', () => {
    expect(route(['help', 'nope'])).toEqual({
      kind: 'usage-error',
      message: "no help topic 'nope'.",
    })
  })
})

describe('Session link launches', () => {
  it.each([
    ['openwaggle://sessions/session-1', 'openwaggle://sessions/session-1'],
    ['openwaggle://sessions/session-1/', 'openwaggle://sessions/session-1/'],
    ['  openwaggle://sessions/session-1', 'openwaggle://sessions/session-1'],
  ])('opens the desktop app for %j', (argument, link) => {
    expect(route([argument])).toEqual({ kind: 'open-session-link', link })
    expect(packagedRoute([argument])).toEqual({ kind: 'open-session-link', link })
  })

  it.each([
    'openwaggle://app/index.html',
    'openwaggle://sessions/session-1?prompt=run',
    'OPENWAGGLE://sessions/',
  ])('refuses %j before the desktop app starts', (link) => {
    expect(route([link])).toEqual({
      kind: 'usage-error',
      message: 'not a Session link. A Session link looks like openwaggle://sessions/<session-id>.',
    })
  })

  it('refuses arguments after a Session link', () => {
    expect(route(['openwaggle://sessions/session-1', 'extra'])).toEqual({
      kind: 'usage-error',
      message: "unexpected argument 'extra' after a Session link.",
    })
  })
})

describe('command suggestions', () => {
  it('computes optimal string alignment distance', () => {
    expect(editDistance('sessions', 'sessions')).toBe(0)
    expect(editDistance('sesions', 'sessions')).toBe(1)
    expect(editDistance('sessoins', 'sessions')).toBe(1)
    expect(editDistance('', 'run')).toBe(3)
    expect(editDistance('kitten', 'sitting')).toBe(3)
  })

  it('does not suggest distant or ambiguous words', () => {
    expect(suggestTopLevelCommand('xyz')).toBeUndefined()
    expect(suggestTopLevelCommand('re')).toBeUndefined()
  })
})
