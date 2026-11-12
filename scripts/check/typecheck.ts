/**
 * Typechecks every project in one pass (tsconfig.json references packages, scripts, node, web and
 * renderer-tests) and applies the renderer-test exemption ratchet
 * (scripts/check-renderer-test-types.ts).
 *
 * The checker is `bun check -b` (ADR 0064): it checks all three projects from source with no build
 * cache and reports the same diagnostics as tsc. Measured in CI (4 vCPU, medians of 5) at 9.1s
 * cold against 45s for `tsc -b --force`. Locally (14-core macOS, loaded) it takes 3.3-4.2s for any
 * edit, where incremental `tsc -b` took 1.2-2.4s after a function-body or renderer edit but
 * 8-13s after an edit that changes a main-process or shared export; one checker everywhere keeps
 * local and CI results identical. tsc only reads the renderer-test project's config
 * (`--showConfig`) for the ratchet's option and file-count guards.
 *
 *   bun scripts/check/typecheck.ts [--update]
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
import { compactTscLine } from './findings'
import { Schema } from '@shared/schema'
import { objectFields, unknownField } from '../support/object-fields'

const OUTPUT_MAX_BUFFER_BYTES = 64 * 1024 * 1024
const JSON_INDENT = 2
const MILLISECONDS_PER_SECOND = 1000
const SCRIPT_ARGUMENTS_START = 2

interface ProcessResult {
  readonly output: string
  readonly failed: boolean
}

function run(command: string, args: readonly string[]) {
  return new Promise<ProcessResult>((resolve, reject) => {
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

/** `bun check` from the Bun running this script: every project in tsconfig.json's references. */
function runChecker() {
  return run(process.execPath, ['check', '--no-script', '--no-pretty', '--all', '-b'])
}

/** The fields of `tsc --showConfig` the renderer test check reads. */
const shownConfigSchema = Schema.Struct({ compilerOptions: unknownField, files: unknownField })

async function readProjectConfig() {
  const { output } = await run('node', [tscEntry(), '-p', RENDERER_TEST_PROJECT, '--showConfig'])
  const parsed: unknown = JSON.parse(output)
  const { compilerOptions: options, files } = objectFields(shownConfigSchema, parsed) ?? {}
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

async function main(argv: readonly string[]) {
  const started = performance.now()
  const [result, config, exemptions] = await Promise.all([
    runChecker(),
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
    console.log(`typecheck: no errors (bun check -b${exempt}, ${seconds}s)`)
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
