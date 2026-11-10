/**
 * Typechecks every project in one pass (tsconfig.json references node, web and renderer-tests) and
 * applies the renderer-test exemption ratchet (scripts/check-renderer-test-types.ts).
 *
 * Two engines, picked by measurement (November 2026, 14-core macOS, load 6-9): a local run uses
 * `tsc -b`, incremental in .typecheck/ (0.4s with nothing changed, about 2s after an edit, 11-13s
 * cold); CI has no .typecheck cache, so it uses `bun check -b` from the pinned Bun canary, which
 * checks all three projects in about 3.5s every time and reported the same errors as tsc, with the
 * same locations and messages, on a probe set covering each project, including declaration-emit
 * errors (TS4094).
 *
 *   bun scripts/check/typecheck.ts [--engine=tsc|bun] [--update]
 *
 * Prints one line when clean, otherwise one `file:line:col TSxxxx message` line per error.
 * `--update` rewrites the renderer-test exemption list from this run (after fixing files).
 */
import { execFile } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import { performance } from 'node:perf_hooks'
import { pathToFileURL } from 'node:url'
import {
  evaluateRendererTestTypes,
  isRendererTestFile,
  RENDERER_TEST_EXEMPTIONS_FILE,
  RENDERER_TEST_PROJECT,
} from '../check-renderer-test-types'
import { bunLintExecutable } from '../lint'
import { compactTscLine } from './findings'

const ROOT_PROJECT = 'tsconfig.json'
const OUTPUT_MAX_BUFFER_BYTES = 64 * 1024 * 1024
const JSON_INDENT = 2
const MILLISECONDS_PER_SECOND = 1000
const SCRIPT_ARGUMENTS_START = 2

export type TypecheckEngine = 'tsc' | 'bun'

interface ProcessResult {
  readonly output: string
  readonly failed: boolean
}

function run(command: string, args: readonly string[]): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    execFile(
      command,
      [...args],
      { maxBuffer: OUTPUT_MAX_BUFFER_BYTES, env: { ...process.env, NO_COLOR: '1' } },
      (error, stdout, stderr) => {
        if (error !== null && typeof error.code !== 'number') {
          reject(error)
          return
        }
        resolve({ output: `${stdout}\n${stderr}`.trim(), failed: error !== null })
      },
    )
  })
}

function tscEntry() {
  const require = createRequire(import.meta.url)
  return path.join(path.dirname(require.resolve('typescript/package.json')), 'bin', 'tsc')
}

/** CI checks out without .typecheck/, where `bun check` is about 3x faster than a cold `tsc -b`. */
export function defaultEngine(environment: NodeJS.ProcessEnv = process.env): TypecheckEngine {
  return environment.CI === 'true' || environment.CI === '1' ? 'bun' : 'tsc'
}

function runEngine(engine: TypecheckEngine) {
  if (engine === 'bun') {
    return run(bunLintExecutable(), ['check', '--no-script', '--no-pretty', '--all', '-b'])
  }
  return run('node', [tscEntry(), '-b', ROOT_PROJECT, '--emitDeclarationOnly', '--pretty', 'false'])
}

async function readProjectConfig() {
  const { output } = await run('node', [tscEntry(), '-p', RENDERER_TEST_PROJECT, '--showConfig'])
  const parsed: unknown = JSON.parse(output)
  const record = parsed !== null && typeof parsed === 'object' ? parsed : {}
  const options: unknown = Reflect.get(record, 'compilerOptions')
  const files: unknown = Reflect.get(record, 'files')
  return {
    compilerOptions: options !== null && typeof options === 'object' ? { ...options } : {},
    rootFiles: Array.isArray(files)
      ? files.filter((file): file is string => typeof file === 'string')
      : [],
  }
}

async function readExemptions() {
  try {
    const parsed: unknown = JSON.parse(await readFile(RENDERER_TEST_EXEMPTIONS_FILE, 'utf8'))
    if (!Array.isArray(parsed)) return []
    return parsed.filter((entry): entry is string => typeof entry === 'string')
  } catch {
    return []
  }
}

function parseEngine(argv: readonly string[]): TypecheckEngine {
  const flag = argv.find((argument) => argument.startsWith('--engine='))
  if (flag === undefined) return defaultEngine()
  const value = flag.slice('--engine='.length)
  if (value !== 'tsc' && value !== 'bun') throw new Error(`unknown --engine=${value}`)
  return value
}

async function main(argv: readonly string[]) {
  const engine = parseEngine(argv)
  const started = performance.now()
  const [result, config, exemptions] = await Promise.all([
    runEngine(engine),
    readProjectConfig(),
    readExemptions(),
  ])
  const verdict = evaluateRendererTestTypes({ ...result, ...config, exemptions })

  if (argv.includes('--update')) {
    const failing = verdict.failingFiles.filter((file) => isRendererTestFile(`/${file}`))
    await writeFile(
      RENDERER_TEST_EXEMPTIONS_FILE,
      `${JSON.stringify(failing, null, JSON_INDENT)}\n`,
      'utf8',
    )
    console.log(`typecheck: ${failing.length} exempt renderer test file(s) written`)
    return
  }

  const seconds = ((performance.now() - started) / MILLISECONDS_PER_SECOND).toFixed(1)
  if (verdict.ok) {
    const exempt = exemptions.length > 0 ? `, ${exemptions.length} exempt test files` : ''
    console.log(
      `typecheck: no errors (${engine === 'bun' ? 'bun check' : 'tsc'} -b${exempt}, ${seconds}s)`,
    )
    return
  }
  for (const line of verdict.reportedErrors) console.log(compactTscLine(line) ?? line)
  for (const message of verdict.messages) console.log(message)
  process.exitCode = 1
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(SCRIPT_ARGUMENTS_START)).catch((error: unknown) => {
    console.error(error)
    process.exitCode = 1
  })
}
