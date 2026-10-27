import { readdirSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { transformSync } from '@babel/core'

/**
 * React Compiler coverage for the streaming hot path.
 *
 * The app build runs the compiler with `panicThreshold: 'none'`, so a component or hook the
 * compiler cannot handle is emitted uncompiled without any build error. On the chat surface that
 * silently drops memoization for every streamed token. This module reruns the same compiler over
 * a set of source roots and reports every function that bailed out.
 */

/** The same code filter `reactCompilerPreset` (`@vitejs/plugin-react`) gives Rolldown. */
const COMPILER_CODE_FILTER = /forwardRef|memo|\b(?:[A-Z]|use[A-Z0-9])/u
const SOURCE_FILE_PATTERN = /\.tsx?$/u
const EXCLUDED_FILE_PATTERN = /\.test\.|\.d\.ts$/u
const EXCLUDED_DIRECTORIES: ReadonlySet<string> = new Set(['__tests__', 'test-utils'])
const BAILOUT_EVENT_KINDS: ReadonlySet<string> = new Set(['CompileError', 'PipelineError'])

export interface ReactCompilerBailout {
  readonly file: string
  readonly line: number | null
  readonly kind: string
  readonly reason: string
}

function sourceFiles(directory: string) {
  const files: string[] = []
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      if (!EXCLUDED_DIRECTORIES.has(entry.name)) files.push(...sourceFiles(entryPath))
      continue
    }
    if (SOURCE_FILE_PATTERN.test(entry.name) && !EXCLUDED_FILE_PATTERN.test(entry.name)) {
      files.push(entryPath)
    }
  }
  return files.sort()
}

function recordField(value: unknown, key: string): unknown {
  return typeof value === 'object' && value !== null ? Reflect.get(value, key) : undefined
}

function eventLine(event: unknown): number | null {
  const start = recordField(recordField(event, 'fnLoc'), 'start')
  const line = recordField(start, 'line')
  return typeof line === 'number' ? line : null
}

function eventReason(event: unknown) {
  const detail = recordField(event, 'detail')
  const reason =
    recordField(detail, 'reason') ??
    recordField(recordField(detail, 'options'), 'reason') ??
    recordField(event, 'reason')
  return typeof reason === 'string' ? reason : 'unknown reason'
}

const require = createRequire(import.meta.url)
const COMPILER_PLUGIN_PATH = require.resolve('babel-plugin-react-compiler')

export interface ReactCompilerOutput {
  readonly code: string
  readonly bailouts: readonly ReactCompilerBailout[]
}

/**
 * Compiles one source text the way the app build does: the same compiler package, under the same
 * Babel major (`@rolldown/plugin-babel` resolves the root `@babel/core`), parsing TypeScript + JSX.
 */
export function compileWithReactCompiler(
  code: string,
  filename: string,
  displayName = filename,
): ReactCompilerOutput {
  const bailouts: ReactCompilerBailout[] = []
  const result = transformSync(code, {
    filename,
    babelrc: false,
    configFile: false,
    parserOpts: { plugins: ['typescript', 'jsx'] },
    plugins: [
      [
        COMPILER_PLUGIN_PATH,
        {
          panicThreshold: 'none',
          logger: {
            logEvent(_file: string | null, event: unknown) {
              const kind = recordField(event, 'kind')
              if (typeof kind !== 'string' || !BAILOUT_EVENT_KINDS.has(kind)) return
              bailouts.push({
                file: displayName,
                line: eventLine(event),
                kind,
                reason: eventReason(event).replace(/\s+/gu, ' '),
              })
            },
          },
        },
      ],
    ],
  })
  return { code: result?.code ?? '', bailouts }
}

/** Compiles one source text and returns the functions the compiler left uncompiled. */
export function reactCompilerBailoutsForSource(
  code: string,
  filename: string,
  displayName = filename,
): readonly ReactCompilerBailout[] {
  if (!COMPILER_CODE_FILTER.test(code)) return []
  return compileWithReactCompiler(code, filename, displayName).bailouts
}

/** Every bailout under the given roots, with paths relative to `repositoryRoot`. */
export function reactCompilerBailouts(
  repositoryRoot: string,
  roots: readonly string[],
): readonly ReactCompilerBailout[] {
  return roots.flatMap((root) =>
    sourceFiles(path.join(repositoryRoot, root)).flatMap((file) =>
      reactCompilerBailoutsForSource(
        readFileSync(file, 'utf8'),
        file,
        path.relative(repositoryRoot, file).split(path.sep).join('/'),
      ),
    ),
  )
}

export interface ReactCompilerGateResult {
  /** Bailouts in files that may not have any. */
  readonly unexpected: readonly ReactCompilerBailout[]
  /** Allowlisted files that now compile; the allowlist must shrink with them. */
  readonly stale: readonly string[]
}

/**
 * Compares bailouts with an allowlist of file → bailout count. A file over its count fails, and so
 * does an allowlisted file that now has fewer bailouts than listed, so the list can only shrink.
 */
export function evaluateReactCompilerGate(
  bailouts: readonly ReactCompilerBailout[],
  allowlist: Readonly<Record<string, number>>,
): ReactCompilerGateResult {
  const counts = new Map<string, number>()
  for (const bailout of bailouts) counts.set(bailout.file, (counts.get(bailout.file) ?? 0) + 1)
  const unexpected = bailouts.filter(
    (bailout) => (counts.get(bailout.file) ?? 0) > (allowlist[bailout.file] ?? 0),
  )
  const stale = Object.entries(allowlist)
    .filter(([file, allowed]) => (counts.get(file) ?? 0) < allowed)
    .map(([file]) => file)
  return { unexpected, stale }
}
