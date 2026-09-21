import { decodeUnknownOrThrow, Schema } from '@shared/schema'
import type { ProjectTaskDiscovery } from '@shared/types/action-definitions'
import { parse } from 'smol-toml'
import { isInvocableTaskName, type ProjectTaskReader, taskReadError } from './task-discovery-types'
import { readTaskSource } from './task-source-files'

const SOURCE = '.cargo/config.toml'
const cargoSchema = Schema.Struct({
  alias: Schema.optional(
    Schema.Record({
      key: Schema.String,
      value: Schema.Union(Schema.String, Schema.Array(Schema.String)),
    }),
  ),
})
const BUILTIN_COMMANDS = new Set([
  'add',
  'bench',
  'build',
  'check',
  'clean',
  'doc',
  'fetch',
  'fix',
  'generate-lockfile',
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

async function list(workspace: string): Promise<ProjectTaskDiscovery> {
  try {
    const raw = await readTaskSource(workspace, SOURCE)
    if (raw === null) return { tasks: [], diagnostics: [] }
    if ((await readTaskSource(workspace, '.cargo/config')) !== null)
      throw new Error(
        'Cargo prefers .cargo/config when both config files exist. Use a custom command or consolidate into config.toml.',
      )
    const data: unknown = parse(raw)
    const aliases = decodeUnknownOrThrow(cargoSchema, data).alias ?? {}
    const diagnostics = []
    const tasks = []
    for (const [task, body] of Object.entries(aliases)) {
      if (!isInvocableTaskName(task) || BUILTIN_COMMANDS.has(task)) {
        diagnostics.push({
          source: SOURCE,
          message: `Cargo cannot invoke this alias name: ${task}`,
        })
        continue
      }
      tasks.push({
        reference: { provider: 'cargo-alias' as const, source: SOURCE, directory: '.', task },
        group: 'Cargo aliases',
        description: typeof body === 'string' ? body : body.join(' '),
        runner: 'cargo',
      })
    }
    return { tasks, diagnostics }
  } catch (error) {
    return { tasks: [], diagnostics: [taskReadError(SOURCE, error)] }
  }
}

export const cargoAliasReader: ProjectTaskReader = { provider: 'cargo-alias', list }
