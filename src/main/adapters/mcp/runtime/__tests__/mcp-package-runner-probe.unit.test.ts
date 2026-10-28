import { afterEach, describe, expect, it } from 'vitest'
import { PackageRunnerBypass } from '../mcp-package-runner-bypass'
import { PROBE_SOURCE, parsePackageRunnerCommand, probeCommand } from '../mcp-package-runner-launch'
import { probeSpawnOf } from '../mcp-package-runner-probe'
import { launchInput, memoryStore, removeScratchDirectories } from './package-runner-fixtures'

afterEach(removeScratchDirectories)

/**
 * What `cmd.exe /d /s /c "<line>"` hands the program: the outer quotes stripped, each escaping `^`
 * outside quotes dropped. It fails where an unescaped `&`, `|`, `<` or `>` outside quotes would
 * end the command, and on unbalanced quotes.
 */
function cmdUnescaped(line: string) {
  expect(line.startsWith('"') && line.endsWith('"')).toBe(true)
  const inner = line.slice(1, -1)
  let unescaped = ''
  let quoted = false
  for (let index = 0; index < inner.length; index += 1) {
    const character = inner[index] ?? ''
    if (character === '^' && !quoted) {
      unescaped += inner[index + 1] ?? ''
      index += 1
      continue
    }
    if (character === '"') quoted = !quoted
    if (!quoted && '&|<>'.includes(character)) throw new Error(`cmd splits at ${character}`)
    unescaped += character
  }
  expect(quoted).toBe(false)
  return unescaped
}

/** A run of backslashes at `index`: what it stands for, and how many characters it spans. */
function backslashRun(commandLine: string, index: number) {
  const slashes = /^\\+/u.exec(commandLine.slice(index))?.[0].length ?? 1
  const beforeQuote = commandLine[index + slashes] === '"'
  if (!beforeQuote) return { text: '\\'.repeat(slashes), length: slashes }
  // Backslashes double before a quote; an odd one escapes the quote itself.
  const escapesQuote = slashes % 2 === 1
  return {
    text: '\\'.repeat(Math.floor(slashes / 2)) + (escapesQuote ? '"' : ''),
    length: escapesQuote ? slashes + 1 : slashes,
  }
}

interface ArgumentsState {
  readonly args: string[]
  current: string | undefined
  inQuotes: boolean
}

/** Reads the character at `index` into `state`; returns how many characters it consumed. */
function readCharacter(state: ArgumentsState, commandLine: string, index: number) {
  const character = commandLine[index] ?? ''
  if (character === '\\') {
    const run = backslashRun(commandLine, index)
    state.current = (state.current ?? '') + run.text
    return run.length
  }
  if (character === '"') {
    state.inQuotes = !state.inQuotes
    state.current ??= ''
    return 1
  }
  if (character === ' ' && !state.inQuotes) {
    if (state.current !== undefined) state.args.push(state.current)
    state.current = undefined
    return 1
  }
  state.current = (state.current ?? '') + character
  return 1
}

/** The arguments a C runtime reads from a command line. */
function cRuntimeArguments(commandLine: string) {
  const state: ArgumentsState = { args: [], current: undefined, inQuotes: false }
  for (let index = 0; index < commandLine.length; ) {
    index += readCharacter(state, commandLine, index)
  }
  if (state.current !== undefined) state.args.push(state.current)
  return state.args
}

function argumentsCmdPasses(line: string) {
  return cRuntimeArguments(cmdUnescaped(line))
}

describe('package runner probe on Windows (review P1-2)', () => {
  const launch = parsePackageRunnerCommand('npx', ['-y', '@scope/server@^1.2.0||>=2<3&x'])

  it('builds a cmd.exe line that hands the runner its exact arguments', () => {
    if (!launch) throw new Error('not a runner launch')
    const npx = 'C:\\Program Files\\nodejs\\npx.cmd'
    const probe = probeCommand(npx, launch)
    const spawned = probeSpawnOf(
      { ...probe, cwd: 'C:\\work', env: { PATH: 'C:\\nodejs', ComSpec: 'C:\\cmd.exe' } },
      'win32',
    )

    expect(spawned.file).toBe('C:\\cmd.exe')
    expect(spawned.windowsVerbatimArguments).toBe(true)
    expect(spawned.args.slice(0, 3)).toEqual(['/d', '/s', '/c'])
    const line = spawned.args[3] ?? ''
    expect(argumentsCmdPasses(line)).toEqual([npx, ...probe.args])
    // The probe source itself survives an npx `.cmd` shim's second pass through cmd.exe.
    expect(PROBE_SOURCE).not.toMatch(/[\s"|&^%<>]/u)
  })

  it('spawns the runner itself, with no shell, elsewhere', () => {
    const spawned = probeSpawnOf({ command: 'npx', args: ['a|b'], cwd: '/w', env: {} }, 'darwin')
    expect(spawned).toEqual({ file: 'npx', args: ['a|b'], windowsVerbatimArguments: false })
  })

  it('does not probe again, or wait, after a probe failed', async () => {
    let probes = 0
    const bypass = new PackageRunnerBypass({
      store: memoryStore(),
      probe: async () => {
        probes += 1
        throw new Error('cmd.exe split the probe')
      },
    })
    await bypass.prepare(launchInput, 5_000)
    await bypass.prepare(launchInput, 5_000)
    bypass.launch(launchInput)
    await bypass.settled()
    expect(probes).toBe(1)

    // Settings' check probes again.
    bypass.launch(launchInput, { refresh: true })
    await bypass.settled()
    expect(probes).toBe(2)
  })
})
