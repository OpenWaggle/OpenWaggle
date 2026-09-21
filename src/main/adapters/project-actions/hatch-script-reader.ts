import { decodeUnknownOrThrow, Schema, type SchemaType } from '@shared/schema'
import {
  ACTION_DEFINITION_LIMITS,
  type DiscoveredProjectTask,
  type ProjectTaskDiscovery,
} from '@shared/types/action-definitions'
import { parse } from 'smol-toml'
import {
  isInvocableTaskName,
  limitDiscoveredTasks,
  type ProjectTaskReader,
  taskReadError,
} from './task-discovery-types'
import { readTaskSource } from './task-source-files'

const scriptsSchema = Schema.Record({
  key: Schema.String,
  value: Schema.Union(Schema.String, Schema.Array(Schema.String)),
})
const envSchema = Schema.Struct({
  template: Schema.optional(Schema.String),
  detached: Schema.optional(Schema.Boolean),
  scripts: Schema.optional(scriptsSchema),
  'extra-scripts': Schema.optional(scriptsSchema),
  matrix: Schema.optional(Schema.Unknown),
})
const hatchSchema = Schema.Struct({
  envs: Schema.optional(Schema.Record({ key: Schema.String, value: envSchema })),
})
const projectSchema = Schema.Struct({
  tool: Schema.optional(Schema.Struct({ hatch: Schema.optional(hatchSchema) })),
})
type Environments = Readonly<Record<string, SchemaType<typeof envSchema>>>
type Scripts = SchemaType<typeof scriptsSchema>

function scriptsFor(
  environments: Environments,
  name: string,
  visited = new Set<string>(),
): Scripts {
  if (visited.has(name)) throw new Error(`Hatch environment inheritance cycle at ${name}.`)
  const environment = environments[name]
  if (!environment) {
    if (name === 'default') return {}
    throw new Error(`Missing Hatch environment template: ${name}.`)
  }
  if (environment.matrix !== undefined)
    throw new Error(
      `Hatch matrix environment ${name} needs a custom command with an explicit selector.`,
    )
  visited.add(name)
  const template = environment.detached ? name : (environment.template ?? 'default')
  const inherited = template === name ? {} : scriptsFor(environments, template, visited)
  return { ...environment['extra-scripts'], ...inherited, ...environment.scripts }
}

async function list(workspace: string): Promise<ProjectTaskDiscovery> {
  const tasks: DiscoveredProjectTask[] = []
  const diagnostics: { source: string; message: string }[] = []
  let source = 'hatch.toml'
  try {
    let raw = await readTaskSource(workspace, source)
    if (raw === null) {
      source = 'pyproject.toml'
      raw = await readTaskSource(workspace, source)
    }
    if (raw === null) return { tasks, diagnostics }
    const data: unknown = parse(raw)
    const config =
      source === 'hatch.toml'
        ? decodeUnknownOrThrow(hatchSchema, data)
        : decodeUnknownOrThrow(projectSchema, data).tool?.hatch
    const environments = config?.envs ?? {}
    for (const environment of Object.keys(environments)) {
      try {
        if (!/^[a-zA-Z0-9_][a-zA-Z0-9_.-]*$/.test(environment))
          throw new Error(`Unsupported Hatch environment selector: ${environment}`)
        for (const [task, body] of Object.entries(scriptsFor(environments, environment))) {
          if (!isInvocableTaskName(task) || task.includes(':'))
            throw new Error(`Unsupported Hatch task name: ${task}`)
          tasks.push({
            reference: { provider: 'hatch-script', source, directory: '.', task, environment },
            group: `Hatch · ${environment}`,
            description: typeof body === 'string' ? body : body.join('\n'),
            runner: 'hatch',
          })
        }
        limitDiscoveredTasks(tasks, ACTION_DEFINITION_LIMITS.DISCOVERED_TASKS)
      } catch (error) {
        diagnostics.push(taskReadError(`${source} · ${environment}`, error))
      }
    }
  } catch (error) {
    diagnostics.push(taskReadError(source, error))
  }
  return { tasks: tasks.slice(0, ACTION_DEFINITION_LIMITS.DISCOVERED_TASKS), diagnostics }
}

export const hatchScriptReader: ProjectTaskReader = { provider: 'hatch-script', list }
