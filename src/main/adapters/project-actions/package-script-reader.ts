import { access, lstat } from 'node:fs/promises'
import { posix, resolve } from 'node:path'
import { match, P } from '@diegogbrisa/ts-match'
import { decodeUnknownOrThrow, parseJsonUnknown, Schema } from '@shared/schema'
import {
  ACTION_DEFINITION_LIMITS,
  type DiscoveredProjectTask,
  type ProjectTaskDiscovery,
  type ProjectTaskReference,
} from '@shared/types/action-definitions'
import { isEnoent } from '@shared/utils/node-error'
import glob from 'fast-glob'
import micromatch from 'micromatch'
import { parseDocument } from 'yaml'
import {
  isInvocableTaskName,
  limitDiscoveredTasks,
  type ProjectTaskReader,
  sameTaskReference,
  taskReadError,
} from './task-discovery-types'
import { readTaskSource, resolveActionPath } from './task-source-files'

const stringList = Schema.Array(Schema.String)
const manifestSchema = Schema.Struct({
  name: Schema.optionalWith(Schema.String, { exact: true }),
  packageManager: Schema.optionalWith(Schema.String, { exact: true }),
  scripts: Schema.optionalWith(Schema.Record({ key: Schema.String, value: Schema.String }), {
    exact: true,
  }),
  workspaces: Schema.optionalWith(
    Schema.Union(stringList, Schema.Struct({ packages: stringList })),
    { exact: true },
  ),
})
const workspaceSchema = Schema.Struct({
  packages: Schema.optionalWith(stringList, { exact: true }),
})
const PACKAGE_MANAGERS = new Set(['npm', 'pnpm', 'yarn', 'bun'])
const LOCKFILES = [
  ['package-lock.json', 'npm'],
  ['npm-shrinkwrap.json', 'npm'],
  ['pnpm-lock.yaml', 'pnpm'],
  ['yarn.lock', 'yarn'],
  ['bun.lock', 'bun'],
  ['bun.lockb', 'bun'],
] as const
const EXCLUDED_DIRECTORIES = [
  'node_modules',
  '.git',
  '.openwaggle',
  '.yarn',
  '.pnpm',
  'dist',
  'build',
  'coverage',
  'target',
  '.venv',
  'venv',
  '.next',
]
const WORKSPACE_GLOB_DEPTH = 16
const WORKSPACE_MATCH_OPTIONS = { dot: false, matchBase: false, posix: true, strictSlashes: false }

function matchesWorkspaceDirectory(directory: string, pattern: string) {
  return (
    micromatch.isMatch(directory, pattern, WORKSPACE_MATCH_OPTIONS) ||
    micromatch.isMatch(`${directory}/`, pattern, WORKSPACE_MATCH_OPTIONS)
  )
}

async function packageManifest(workspace: string, source: string) {
  const raw = await readTaskSource(workspace, source)
  return raw === null ? null : decodeUnknownOrThrow(manifestSchema, parseJsonUnknown(raw))
}

async function runnerFor(workspace: string, directory: string, declared: string | undefined) {
  if (declared !== undefined) {
    const manager = declared.split('@')[0] ?? ''
    return PACKAGE_MANAGERS.has(manager)
      ? { runner: manager }
      : {
          runner: null,
          unavailableReason: `Unsupported packageManager: ${declared}. Use a custom command.`,
        }
  }
  let searchDirectory = directory
  while (true) {
    const runners = new Set<string>()
    // Lockfiles only establish presence; they can legitimately be larger than a task source.
    // Checked at once, then read in LOCKFILES order as if each were checked in turn.
    const directory = searchDirectory
    const checks = await Promise.allSettled(
      LOCKFILES.map(async ([file, manager]) => {
        await access(await resolveActionPath(workspace, posix.join(directory, file)))
        return manager
      }),
    )
    for (const check of checks) {
      if (check.status === 'fulfilled') {
        runners.add(check.value)
        continue
      }
      if (!isEnoent(check.reason)) throw check.reason
    }
    if (runners.size > 1) {
      return {
        runner: null,
        unavailableReason: 'Conflicting lockfiles. Declare packageManager in package.json.',
      }
    }
    const runner = runners.values().next().value
    if (runner) return { runner }
    if (searchDirectory === '.') return { runner: 'npm' }
    searchDirectory = posix.dirname(searchDirectory)
  }
}

function safeWorkspacePattern(pattern: string) {
  const positive = pattern.startsWith('!') ? pattern.slice(1) : pattern
  if (
    !positive ||
    positive.startsWith('/') ||
    positive.includes('\\') ||
    positive.includes(':') ||
    positive.split('/').includes('..')
  ) {
    throw new Error(`Workspace pattern must stay inside the project: ${pattern}`)
  }
  return pattern
}

async function workspacePatterns(
  workspace: string,
  manifest: NonNullable<Awaited<ReturnType<typeof packageManifest>>>,
) {
  const patterns = [
    ...match(manifest.workspaces)
      .with(P.array(P.string), (workspaces) => workspaces)
      .with({ packages: P.select() }, (packages) => packages)
      .otherwise(() => []),
  ]
  const pnpmSource = await readTaskSource(workspace, 'pnpm-workspace.yaml')
  if (pnpmSource !== null) {
    const yaml = parseDocument(pnpmSource)
    if (yaml.errors.length) throw new Error(yaml.errors.map((error) => error.message).join('; '))
    const value: unknown = yaml.toJS({ maxAliasCount: 0 })
    patterns.push(...(decodeUnknownOrThrow(workspaceSchema, value).packages ?? []))
  }
  return patterns.map(safeWorkspacePattern)
}

async function packageSources(
  workspace: string,
  manifest: NonNullable<Awaited<ReturnType<typeof packageManifest>>>,
) {
  const patterns = await workspacePatterns(workspace, manifest)
  if (patterns.length === 0) return ['package.json']
  const matches = await glob(patterns, {
    cwd: workspace,
    onlyDirectories: true,
    followSymbolicLinks: false,
    deep: WORKSPACE_GLOB_DEPTH,
    unique: true,
    ignore: EXCLUDED_DIRECTORIES.map((directory) => `**/${directory}/**`),
  })
  if (matches.length > ACTION_DEFINITION_LIMITS.WORKSPACE_PACKAGES) {
    throw new Error('Too many workspace packages to discover safely.')
  }
  return [
    ...new Set([
      'package.json',
      ...matches.sort().map((directory) => posix.join(posix.normalize(directory), 'package.json')),
    ]),
  ]
}

async function requestedPackageSource(
  workspace: string,
  manifest: NonNullable<Awaited<ReturnType<typeof packageManifest>>>,
  reference: ProjectTaskReference,
) {
  const directory = reference.directory
  if (reference.source !== posix.join(directory, 'package.json')) return []
  if (directory === '.') return ['package.json']
  const segments = directory.split('/')
  if (
    segments.length > WORKSPACE_GLOB_DEPTH ||
    segments.some(
      (segment) =>
        !segment || segment === '.' || segment === '..' || EXCLUDED_DIRECTORIES.includes(segment),
    )
  ) {
    return []
  }
  const patterns = await workspacePatterns(workspace, manifest)
  const ancestors = segments.map((_, index) => segments.slice(0, index + 1).join('/'))
  if (
    !patterns.some(
      (pattern) => !pattern.startsWith('!') && matchesWorkspaceDirectory(directory, pattern),
    ) ||
    patterns.some(
      (pattern) =>
        pattern.startsWith('!') &&
        ancestors.some((ancestor) => matchesWorkspaceDirectory(ancestor, pattern.slice(1))),
    )
  ) {
    return []
  }
  for (let depth = 1; depth <= segments.length; depth += 1) {
    const path = resolve(workspace, ...segments.slice(0, depth))
    try {
      const metadata = await lstat(path)
      if (metadata.isSymbolicLink() || !metadata.isDirectory()) return []
    } catch (error) {
      if (isEnoent(error)) return []
      throw error
    }
  }
  return [reference.source]
}

/** One package source's tasks and diagnostics. Only a source that was read checks the task limit. */
async function packageSourceTasks(
  workspace: string,
  source: string,
  root: NonNullable<Awaited<ReturnType<typeof packageManifest>>>,
  requested?: ProjectTaskReference,
) {
  const tasks: DiscoveredProjectTask[] = []
  const diagnostics: { source: string; message: string }[] = []
  try {
    const manifest = source === 'package.json' ? root : await packageManifest(workspace, source)
    if (manifest === null) return { source, tasks, diagnostics, read: false }
    const directory = posix.dirname(source)
    const runner = await runnerFor(
      workspace,
      directory,
      manifest.packageManager ?? root.packageManager,
    )
    for (const [task, description] of Object.entries(manifest.scripts ?? {})) {
      const reference = { provider: 'package-script' as const, source, task, directory }
      if (requested && !sameTaskReference(reference, requested)) continue
      if (!isInvocableTaskName(task)) {
        diagnostics.push({ source, message: `Unsupported task name: ${task}` })
        continue
      }
      tasks.push({
        reference,
        group: manifest.name ?? directory,
        description,
        ...runner,
      })
    }
    return { source, tasks, diagnostics, read: true }
  } catch (error) {
    diagnostics.push(taskReadError(source, error))
    return { source, tasks, diagnostics, read: false }
  }
}

async function list(workspace: string, requested?: ProjectTaskReference) {
  const tasks: DiscoveredProjectTask[] = []
  const diagnostics: { source: string; message: string }[] = []
  let root: Awaited<ReturnType<typeof packageManifest>>
  try {
    root = await packageManifest(workspace, 'package.json')
  } catch (error) {
    return {
      tasks,
      diagnostics: [taskReadError('package.json', error)],
    } satisfies ProjectTaskDiscovery
  }
  if (root === null) return { tasks, diagnostics } satisfies ProjectTaskDiscovery
  let sources = ['package.json']
  try {
    sources = requested
      ? await requestedPackageSource(workspace, root, requested)
      : await packageSources(workspace, root)
  } catch (error) {
    diagnostics.push(taskReadError('package.json / pnpm-workspace.yaml', error))
  }
  // Sources are read at once and gathered in order. The limit applies to the tasks gathered so
  // far after each source, and every source past it reports that, as when each was read in turn.
  const selected = requested ? sources.filter((source) => source === requested.source) : sources
  const results = await Promise.all(
    selected.map((source) => packageSourceTasks(workspace, source, root, requested)),
  )
  for (const result of results) {
    tasks.push(...result.tasks)
    diagnostics.push(...result.diagnostics)
    if (!result.read || requested) continue
    try {
      limitDiscoveredTasks(tasks, ACTION_DEFINITION_LIMITS.DISCOVERED_TASKS)
    } catch (error) {
      diagnostics.push(taskReadError(result.source, error))
    }
  }
  return {
    tasks: tasks.slice(0, ACTION_DEFINITION_LIMITS.DISCOVERED_TASKS),
    diagnostics,
  } satisfies ProjectTaskDiscovery
}

export const packageScriptReader: ProjectTaskReader = { provider: 'package-script', list }
