import { access } from 'node:fs/promises'
import { posix } from 'node:path'
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
  name: Schema.optional(Schema.String),
  packageManager: Schema.optional(Schema.String),
  scripts: Schema.optional(Schema.Record({ key: Schema.String, value: Schema.String })),
  workspaces: Schema.optional(Schema.Union(stringList, Schema.Struct({ packages: stringList }))),
})
const workspaceSchema = Schema.Struct({ packages: Schema.optional(stringList) })
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
    for (const [file, manager] of LOCKFILES) {
      // Lockfiles only establish presence; they can legitimately be larger than a task source.
      try {
        await access(await resolveActionPath(workspace, posix.join(searchDirectory, file)))
        runners.add(manager)
      } catch (error) {
        if (!isEnoent(error)) throw error
      }
    }
    if (runners.size > 1)
      return {
        runner: null,
        unavailableReason: 'Conflicting lockfiles. Declare packageManager in package.json.',
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

async function packageSources(
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
  if (patterns.length === 0) return ['package.json']
  const matches = await glob(patterns.map(safeWorkspacePattern), {
    cwd: workspace,
    onlyDirectories: true,
    followSymbolicLinks: false,
    deep: WORKSPACE_GLOB_DEPTH,
    unique: true,
    ignore: EXCLUDED_DIRECTORIES.map((directory) => `**/${directory}/**`),
  })
  if (matches.length > ACTION_DEFINITION_LIMITS.WORKSPACE_PACKAGES)
    throw new Error('Too many workspace packages to discover safely.')
  return [
    ...new Set([
      'package.json',
      ...matches.sort().map((directory) => posix.join(directory, 'package.json')),
    ]),
  ]
}

async function appendPackageSourceTasks(
  workspace: string,
  source: string,
  root: NonNullable<Awaited<ReturnType<typeof packageManifest>>>,
  tasks: DiscoveredProjectTask[],
  diagnostics: { source: string; message: string }[],
  requested?: ProjectTaskReference,
) {
  try {
    const manifest = source === 'package.json' ? root : await packageManifest(workspace, source)
    if (manifest === null) return
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
    if (!requested) limitDiscoveredTasks(tasks, ACTION_DEFINITION_LIMITS.DISCOVERED_TASKS)
  } catch (error) {
    diagnostics.push(taskReadError(source, error))
  }
}

async function list(
  workspace: string,
  requested?: ProjectTaskReference,
): Promise<ProjectTaskDiscovery> {
  const tasks: DiscoveredProjectTask[] = []
  const diagnostics: { source: string; message: string }[] = []
  let root: Awaited<ReturnType<typeof packageManifest>>
  try {
    root = await packageManifest(workspace, 'package.json')
  } catch (error) {
    return { tasks, diagnostics: [taskReadError('package.json', error)] }
  }
  if (root === null) return { tasks, diagnostics }
  let sources = ['package.json']
  try {
    sources = await packageSources(workspace, root)
  } catch (error) {
    diagnostics.push(taskReadError('package.json / pnpm-workspace.yaml', error))
  }
  for (const source of sources) {
    if (requested && source !== requested.source) continue
    await appendPackageSourceTasks(workspace, source, root, tasks, diagnostics, requested)
  }
  return { tasks: tasks.slice(0, ACTION_DEFINITION_LIMITS.DISCOVERED_TASKS), diagnostics }
}

export const packageScriptReader: ProjectTaskReader = { provider: 'package-script', list }
