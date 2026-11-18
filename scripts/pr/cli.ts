import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'

/** Scratch files the PR scripts write before handing them to `gh` (`.tmp/` is gitignored). */
export const PR_SCRATCH_DIRECTORY = '.tmp/pr'
const MAX_COMMAND_OUTPUT_BYTES = 64 * 1024 * 1024

export class PrScriptError extends Error {
  override name = 'PrScriptError'
}

/** `bun run x -- --flag` forwards the `--` itself; drop it so flags parse the same either way. */
export function normalizeArgs(args: readonly string[]) {
  return args.at(0) === '--' ? args.slice(1) : [...args]
}

export function hasFlag(args: readonly string[], ...names: readonly string[]) {
  return args.some((argument) => names.includes(argument))
}

/** The value after `--name` or inside `--name=value`; a missing value is an error, not a default. */
export function flagValue(args: readonly string[], name: string) {
  const inline = args.find((argument) => argument.startsWith(`${name}=`))
  if (inline !== undefined) {
    return inline.slice(name.length + 1)
  }
  const index = args.indexOf(name)
  if (index === -1) {
    return undefined
  }
  const value = args[index + 1]
  if (value === undefined || value.startsWith('--')) {
    throw new PrScriptError(`${name} needs a value.`)
  }
  return value
}

/** Arguments with `--name value` and `--name=value` removed. */
export function withoutFlag(args: readonly string[], name: string) {
  const result: string[] = []
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index] ?? ''
    if (argument === name) {
      index += 1
      continue
    }
    if (!argument.startsWith(`${name}=`)) {
      result.push(argument)
    }
  }
  return result
}

export function commandOutput(command: string, args: readonly string[]) {
  return execFileSync(command, [...args], {
    encoding: 'utf8',
    maxBuffer: MAX_COMMAND_OUTPUT_BYTES,
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()
}

export function optionalCommandOutput(command: string, args: readonly string[]) {
  try {
    return commandOutput(command, args)
  } catch {
    return undefined
  }
}

/** Runs a command with inherited stdio; true when it exited 0. */
export function runInherited(command: string, args: readonly string[]) {
  const result = spawnSync(command, [...args], { stdio: 'inherit' })
  if (result.error) {
    console.error(`${command}: ${result.error.message}`)
    return false
  }
  return result.status === 0
}

export function parseJson(text: string) {
  const value: unknown = JSON.parse(text)
  return value
}

export function writeScratchFile(name: string, contents: string) {
  mkdirSync(PR_SCRATCH_DIRECTORY, { recursive: true })
  const filePath = path.join(PR_SCRATCH_DIRECTORY, name)
  writeFileSync(filePath, contents)
  return filePath
}

export function currentHeadSha() {
  return commandOutput('git', ['rev-parse', 'HEAD'])
}

export function currentBranch() {
  return commandOutput('git', ['rev-parse', '--abbrev-ref', 'HEAD'])
}

/** The upstream commit of the current branch, or undefined when the branch was never pushed. */
export function upstreamSha() {
  return optionalCommandOutput('git', ['rev-parse', '@{upstream}'])
}

export function isWorkingTreeClean() {
  return commandOutput('git', ['status', '--porcelain']).length === 0
}

/** Prints a script error without a stack and sets a failing exit code. */
export function reportFailure(prefix: string, error: unknown) {
  console.error(`${prefix}: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
}
