/**
 * Command-line options of the check runner (scripts/check/run.ts).
 */
import os from 'node:os'
import { scriptEnv } from '../support/env'

export const DEFAULT_BASE = 'origin/main'
const CORES_PER_STEP = 2
const MINIMUM_CONCURRENCY = 2

export interface RunOptions {
  readonly gate: string
  readonly only: readonly string[]
  readonly skip: readonly string[]
  readonly changed: boolean
  readonly base: string
  readonly concurrency: number
  readonly cache: boolean
  readonly list: boolean
}

/** Half the cores: most steps (tsc, bun lint, vite, vitest) are multi-threaded themselves. */
export function defaultConcurrency(cores = os.availableParallelism()) {
  return Math.max(MINIMUM_CONCURRENCY, Math.floor(cores / CORES_PER_STEP))
}

function idList(value: string | undefined, flag: string) {
  if (value === undefined || value.startsWith('--')) throw new Error(`${flag} needs a value`)
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '')
}

function positiveInteger(value: string | undefined, flag: string) {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`${flag} needs a positive integer`)
  return parsed
}

type Mutable<T> = { -readonly [K in keyof T]: T[K] }

/** Options that take a value (`--flag value` or `--flag=value`). */
const VALUE_OPTIONS: Readonly<
  Record<string, (options: Mutable<RunOptions>, value: string | undefined, flag: string) => void>
> = {
  '--only': (options, value, flag) => {
    options.only = idList(value, flag)
  },
  '--skip': (options, value, flag) => {
    options.skip = idList(value, flag)
  },
  '--base': (options, value, flag) => {
    options.base = idList(value, flag).join(',')
  },
  '--concurrency': (options, value, flag) => {
    options.concurrency = positiveInteger(value, flag)
  },
}

const SWITCHES: Readonly<Record<string, (options: Mutable<RunOptions>) => void>> = {
  '--changed': (options) => {
    options.changed = true
  },
  '--no-cache': (options) => {
    options.cache = false
  },
  '--list': (options) => {
    options.list = true
  },
}

function initialConcurrency(environment: NodeJS.ProcessEnv) {
  const fromEnvironment = Number(scriptEnv(environment).CHECK_CONCURRENCY)
  return Number.isInteger(fromEnvironment) && fromEnvironment > 0
    ? fromEnvironment
    : defaultConcurrency()
}

export function parseRunArguments(argv: readonly string[], environment = process.env) {
  const options: Mutable<RunOptions> = {
    gate: 'check',
    only: [],
    skip: [],
    changed: false,
    base: DEFAULT_BASE,
    concurrency: initialConcurrency(environment),
    cache: true,
    list: false,
  }
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index] ?? ''
    if (!argument.startsWith('--')) {
      options.gate = argument
      continue
    }
    const separator = argument.indexOf('=')
    const flag = separator === -1 ? argument : argument.slice(0, separator)
    const toggle = SWITCHES[flag]
    if (toggle !== undefined) {
      toggle(options)
      continue
    }
    const apply = VALUE_OPTIONS[flag]
    if (apply === undefined) throw new Error(`unknown option ${argument}`)
    if (separator !== -1) {
      apply(options, argument.slice(separator + 1), flag)
      continue
    }
    index += 1
    apply(options, argv[index], flag)
  }
  return options
}
