import { decodeUnknownOrThrow, Schema } from '@shared/schema'
import type { ProjectTaskDiscovery, ProjectTaskReference } from '@shared/types/action-definitions'
import { parse } from 'smol-toml'
import {
  isInvocableTaskName,
  type ProjectTaskReader,
  sameTaskReference,
  taskReadError,
} from './task-discovery-types'
import { readTaskSource } from './task-source-files'

const SOURCE = '.cargo/config.toml'
const LEGACY_SOURCE = '.cargo/config'
const cargoSchema = Schema.Struct({
  alias: Schema.optional(
    Schema.Record({
      key: Schema.String,
      value: Schema.Union(Schema.String, Schema.Array(Schema.String)),
    }),
  ),
})
// Cargo dispatches these before configured aliases, including hidden/unstable commands.
// https://github.com/rust-lang/cargo/blob/master/src/bin/cargo/commands/mod.rs
const BUILTIN_COMMANDS = new Set([
  'add',
  'bench',
  'build',
  'check',
  'clean',
  'config',
  'doc',
  'fetch',
  'fix',
  'generate-lockfile',
  'git-checkout',
  'help',
  'info',
  'init',
  'install',
  'locate-project',
  'login',
  'logout',
  'metadata',
  'new',
  'owner',
  'package',
  'pkgid',
  'publish',
  'read-manifest',
  'remove',
  'report',
  'run',
  'rustc',
  'rustdoc',
  'search',
  'test',
  'tree',
  'uninstall',
  'update',
  'vendor',
  'verify-project',
  'version',
  'yank',
])

async function list(
  workspace: string,
  requested?: ProjectTaskReference,
): Promise<ProjectTaskDiscovery> {
  let source = SOURCE
  try {
    let raw = await readTaskSource(workspace, source)
    if (raw !== null && (await readTaskSource(workspace, LEGACY_SOURCE)) !== null) {
      throw new Error(
        'Cargo prefers .cargo/config when both config files exist. Use a custom command or consolidate into config.toml.',
      )
    }
    if (raw === null) {
      source = LEGACY_SOURCE
      raw = await readTaskSource(workspace, source)
    }
    if (raw === null) return { tasks: [], diagnostics: [] }
    const data: unknown = parse(raw)
    const aliases = decodeUnknownOrThrow(cargoSchema, data).alias ?? {}
    const diagnostics = []
    const tasks = []
    for (const [task, body] of Object.entries(aliases)) {
      const reference = { provider: 'cargo-alias' as const, source, directory: '.', task }
      if (requested && !sameTaskReference(reference, requested)) continue
      if (!isInvocableTaskName(task) || BUILTIN_COMMANDS.has(task)) {
        diagnostics.push({
          source,
          message: `Cargo cannot invoke this alias name: ${task}`,
        })
        continue
      }
      tasks.push({
        reference,
        group: 'Cargo aliases',
        description: typeof body === 'string' ? body : body.join(' '),
        runner: 'cargo',
      })
    }
    return { tasks, diagnostics }
  } catch (error) {
    return { tasks: [], diagnostics: [taskReadError(source, error)] }
  }
}

export const cargoAliasReader: ProjectTaskReader = { provider: 'cargo-alias', list }
