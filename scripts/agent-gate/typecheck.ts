/**
 * Type-checks the TypeScript projects a change affects, whole: `tsconfig.node.json` for main,
 * preload, shared, packages and scripts, and `tsconfig.web.json` (incremental `tsc -b`) for the
 * renderer and shared code. TypeScript 7's native compiler checks a project in a few seconds, as
 * fast as a type-aware lint run over one file, and running both in parallel also catches a caller
 * that a changed signature breaks.
 *
 * Errors in changed files always count. Errors elsewhere count when the Session-start run did not
 * have them, so a tree that was already broken does not block an agent that did not break it.
 */
import { createRequire } from 'node:module'
import path from 'node:path'
import type { Finding, ToolFailure } from './findings'
import type { RunProcess } from '../agent-quality-gates/process'
import { failureReason } from './git'

export type Project = 'node' | 'web'

export interface TypeError {
  readonly file: string
  readonly line: number
  readonly column: number
  readonly code: string
  readonly message: string
}

export interface TypecheckResult {
  readonly errors: readonly TypeError[]
  readonly failures: readonly ToolFailure[]
}

const PROJECT_ARGUMENTS: Readonly<Record<Project, readonly string[]>> = {
  node: ['--noEmit', '-p', 'tsconfig.node.json', '--pretty', 'false'],
  web: ['-b', 'tsconfig.web.json', '--emitDeclarationOnly', '--pretty', 'false'],
}
const NODE_FILES =
  /^(?:(?:src\/(?:main|preload|shared)|packages|scripts|functions|website\/src\/lib|\.pi\/extensions)\/.*\.(?:[cm]?tsx?)|[^/]+\.config\.m?ts|electron-builder\.ts|tsconfig(?:\.node)?\.json)$/u
const WEB_FILES = /^(?:src\/(?:renderer\/src|shared)\/.*\.tsx?|tsconfig\.web\.json)$/u
const WEB_EXCLUDED = /\.test\.tsx?$/u
const TSC_ERROR =
  /^(?<file>.+?)\((?<line>\d+),(?<column>\d+)\): error (?<code>TS\d+): (?<message>.*)$/u
const TYPECHECK_TIMEOUT_MS = 120_000
const ERRORS_EXIT_CODES = new Set([1, 2])

export function affectedProjects(files: readonly string[]): Project[] {
  const projects: Project[] = []
  if (files.some((file) => NODE_FILES.test(file))) projects.push('node')
  if (files.some((file) => WEB_FILES.test(file) && !WEB_EXCLUDED.test(file))) projects.push('web')
  return projects
}

export function parseTscErrors(output: string): TypeError[] {
  return output.split('\n').flatMap((line) => {
    const groups = TSC_ERROR.exec(line.trim())?.groups
    if (groups === undefined) return []
    const { file = '', code = '', message = '' } = groups
    return [{ file, line: Number(groups['line']), column: Number(groups['column']), code, message }]
  })
}

export function typeErrorKey(error: TypeError) {
  return `${error.file} ${error.code} ${error.message}`
}

function tscBinary(root: string) {
  const manifest = createRequire(path.join(root, 'package.json')).resolve('typescript/package.json')
  return path.join(path.dirname(manifest), 'bin', 'tsc')
}

async function checkProject(
  run: RunProcess,
  root: string,
  project: Project,
  signal?: AbortSignal,
): Promise<TypecheckResult> {
  let tsc: string
  try {
    tsc = tscBinary(root)
  } catch {
    return {
      errors: [],
      failures: [
        {
          check: `typecheck ${project}`,
          files: [],
          reason: 'typescript is not installed; run bun install',
        },
      ],
    }
  }
  const result = await run('node', [tsc, ...PROJECT_ARGUMENTS[project]], {
    cwd: root,
    timeoutMs: TYPECHECK_TIMEOUT_MS,
    ...(signal === undefined ? {} : { signal }),
  })
  const errors = parseTscErrors(result.stdout)
  if (
    result.code === 0 ||
    (result.code !== null && ERRORS_EXIT_CODES.has(result.code) && errors.length > 0)
  ) {
    return { errors, failures: [] }
  }
  const reason = failureReason(result)
  return { errors: [], failures: [{ check: `typecheck ${project}`, files: [], reason }] }
}

export async function typecheckProjects(
  run: RunProcess,
  root: string,
  projects: readonly Project[],
  signal?: AbortSignal,
): Promise<TypecheckResult> {
  const results = await Promise.all(
    projects.map((project) => checkProject(run, root, project, signal)),
  )
  return {
    errors: results.flatMap((result) => result.errors),
    failures: results.flatMap((result) => result.failures),
  }
}

/**
 * Type errors as findings: blocking in changed files and wherever `baseline` (the error keys of
 * the Session-start run) did not have them; advisory elsewhere when there is no baseline.
 */
export function typeErrorFindings(
  errors: readonly TypeError[],
  changed: readonly string[],
  baseline: ReadonlySet<string> | undefined,
): Finding[] {
  const own = new Set(changed)
  return errors.flatMap((error) => {
    const known = baseline?.has(typeErrorKey(error)) === true
    if (!own.has(error.file) && known) return []
    const blocks = own.has(error.file) || baseline !== undefined
    return [
      {
        file: error.file,
        line: error.line,
        column: error.column,
        rule: error.code,
        message: error.message,
        severity: blocks ? ('block' as const) : ('advisory' as const),
      },
    ]
  })
}
