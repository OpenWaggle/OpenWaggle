/**
 * Every JSON example in the configuration docs is read by the code that reads the real file, and
 * checked against the published JSON Schema where one exists, so an example cannot drift from
 * what OpenWaggle and Pi accept.
 */
import { writeFileSync } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { projectSettingsFileSchema } from '@shared/schemas/validation'
import type { ScheduledTask, ScheduledTasksResponse } from '@shared/types/scheduled-task'
import type { HeartbeatSettingsInput } from '@shared/types/scheduled-task-heartbeat'
import { fromPartial } from '@total-typescript/shoehorn'
import JsonSchema from 'typebox/schema'
import { afterEach, describe, expect, it } from 'vitest'
import { parseMcpCliArguments } from '../../src/main/mcp-cli-arguments'
import { scheduledTasksExport as printedScheduledTasksExport } from '../../src/main/schedules-cli-output'
import { buildSchedulesCliCommands } from '../../src/main/schedules-cli-payload'
import { PUBLISHED_JSON_SCHEMAS } from '../published-json-schemas'
import {
  type FencedBlock,
  fencedBlocks,
  mcpFileErrorsAtRuntime,
  publishedSchemaErrors,
  REPOSITORY_ROOT,
  readActionsFileAtRuntime,
  readSettingsFileAtRuntime,
  readWagglePresetsFileAtRuntime,
  record,
  removeScratchDirectories,
  scratchDirectory,
} from './published-json-schemas.test-harness'

/** The exported Heartbeat of a task created from `input`: omitted settings stay omitted. */
function exportedHeartbeat(input: HeartbeatSettingsInput) {
  return {
    ...(input.stopWhen === undefined ? {} : { stopWhen: input.stopWhen }),
    ...(input.indefinite === undefined ? {} : { indefinite: input.indefinite }),
    ...(input.idlePauseAfter === undefined ? {} : { idlePauseAfter: input.idlePauseAfter }),
    wakeCheck: input.wakeCheck
      ? {
          command: input.wakeCheck.command,
          ...(input.wakeCheck.onFailure === undefined
            ? {}
            : { onFailure: input.wakeCheck.onFailure }),
        }
      : null,
  }
}

afterEach(removeScratchDirectories)

/** Development tooling loads Pi dynamically; static Pi imports belong to the app's Pi adapter. */
function loadPi() {
  return import('@earendil-works/pi-coding-agent')
}

function isRecord(value: unknown) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

interface ExampleKind {
  readonly name: string
  readonly matches: (value: unknown) => boolean
  readonly check: (value: unknown) => Promise<void>
}

const PUBLISHED_SCHEMA_URL = /^https:\/\/openwaggle\.ai\/schemas\/([^/]+)$/u

const vscodeSchemaAssociation: ExampleKind = {
  name: 'VS Code json.schemas',
  matches: (value) => isRecord(value) && 'json.schemas' in record(value),
  check: async (value) => {
    const associations = record(value)['json.schemas']
    if (!Array.isArray(associations)) throw new Error('json.schemas must be a list.')
    for (const association of associations) {
      const { url, fileMatch } = record(association)
      const fileName = typeof url === 'string' ? PUBLISHED_SCHEMA_URL.exec(url)?.[1] : undefined
      expect(PUBLISHED_JSON_SCHEMAS.map((schema) => schema.fileName)).toContain(fileName)
      expect(Array.isArray(fileMatch) && fileMatch.length > 0).toBe(true)
    }
  },
}

/** A `$schema` an example names must be the published schema for that file. */
function expectSchemaKey(value: unknown, fileName: string) {
  if (!isRecord(value) || !('$schema' in record(value))) return
  expect(record(value)['$schema']).toBe(`https://openwaggle.ai/schemas/${fileName}`)
}

const actionsFile: ExampleKind = {
  name: '.openwaggle/actions.json',
  matches: (value) => isRecord(value) && 'actions' in record(value) && 'version' in record(value),
  check: async (value) => {
    expect(await publishedSchemaErrors('project-actions-v1.schema.json', value)).toEqual([])
    const catalog = await readActionsFileAtRuntime(value)
    expect(catalog.actions.length).toBeGreaterThan(0)
  },
}

/** The top-level keys OpenWaggle reads from `.openwaggle/settings.json`, and `$schema`. */
const SETTINGS_KEYS = new Set(['$schema', ...Object.keys(projectSettingsFileSchema.fields)])

const settingsFile: ExampleKind = {
  name: '.openwaggle/settings.json',
  // The settings root keeps unknown keys, so an example is a settings file only when every key is
  // one OpenWaggle reads; anything else fails as matching no known format.
  matches: (value) =>
    isRecord(value) &&
    Object.keys(record(value)).length > 0 &&
    Object.keys(record(value)).every((key) => SETTINGS_KEYS.has(key)),
  check: async (value) => {
    expectSchemaKey(value, 'project-settings.schema.json')
    expect(await publishedSchemaErrors('project-settings.schema.json', value)).toEqual([])
    const settings = Object.entries(record(value)).filter(([key]) => key !== '$schema')
    // Every value the example sets reaches the project config the app uses.
    expect(await readSettingsFileAtRuntime(value)).toEqual(Object.fromEntries(settings))
  },
}

const mcpFile: ExampleKind = {
  name: 'mcp.json',
  matches: (value) => isRecord(value) && 'mcpServers' in record(value),
  check: async (value) => {
    expectSchemaKey(value, 'mcp.schema.json')
    expect(await publishedSchemaErrors('mcp.schema.json', value)).toEqual([])
    expect(mcpFileErrorsAtRuntime(value)).toEqual([])
  },
}

const wagglePresetsFile: ExampleKind = {
  name: 'waggle-presets.json',
  matches: (value) => isRecord(value) && 'wagglePresets' in record(value),
  check: async (value) => {
    expect(await publishedSchemaErrors('waggle-presets.schema.json', value)).toEqual([])
    const read = await readWagglePresetsFileAtRuntime(value)
    expect(read.skipped).toBe(0)
    expect(read.presets.length).toBeGreaterThan(0)
  },
}

const PI_MODELS_SCHEMA = path.join(
  REPOSITORY_ROOT,
  'node_modules/@earendil-works/pi-coding-agent/schemas/models.schema.json',
)

/** Pi's `models.json`: Pi's published schema, then a Pi model runtime that loads the file. */
const piModelsFile: ExampleKind = {
  name: '~/.pi/agent/models.json',
  matches: (value) => isRecord(value) && 'providers' in record(value),
  check: async (value) => {
    const schema: unknown = JSON.parse(await readFile(PI_MODELS_SCHEMA, 'utf8'))
    if (!JsonSchema.IsSchema(schema)) throw new Error('Pi models schema is not a JSON Schema.')
    expect(JsonSchema.Check(schema, value)).toBe(true)
    const agentDirectory = scratchDirectory('ow-pi-models-example-')
    const modelsPath = path.join(agentDirectory, 'models.json')
    writeFileSync(modelsPath, JSON.stringify(value))
    const { ModelRuntime } = await loadPi()
    const runtime = await ModelRuntime.create({
      authPath: path.join(agentDirectory, 'auth.json'),
      modelsPath,
      modelsStorePath: path.join(agentDirectory, 'models-store.json'),
      refreshOnCreate: false,
    })
    expect(runtime.getError()).toBeUndefined()
    for (const [provider, config] of Object.entries(record(record(value)['providers']))) {
      const models = record(config)['models']
      for (const model of Array.isArray(models) ? models : []) {
        const id = record(model)['id']
        expect(
          runtime.getModelsOfType('chat', provider).some((candidate) => candidate.id === id),
          `${provider}/${String(id)}`,
        ).toBe(true)
      }
    }
  },
}

/** What `openwaggle schedules export` prints, and what `import` reads back (ADR 0063). */
const scheduledTasksExport: ExampleKind = {
  name: 'openwaggle schedules export',
  matches: (value) => record(value)['type'] === 'scheduled-tasks',
  check: async (value) => {
    const filePath = path.join(scratchDirectory('ow-schedules-example-'), 'tasks.json')
    writeFileSync(filePath, JSON.stringify(value))
    const commands = await buildSchedulesCliCommands('import', parseMcpCliArguments([filePath]))
    const inputs = commands.map((command) => {
      if (command.operation !== 'create') throw new Error('import must only create tasks.')
      return command.input
    })
    // The export of tasks created from these inputs is the example itself.
    const tasks = inputs.map((input) =>
      fromPartial<ScheduledTask>({
        id: 'task',
        name: input.name,
        prompt: input.prompt,
        enabled: input.enabled,
        schedule: input.schedule,
        target: input.target,
        ...(input.timeZone === undefined ? {} : { timeZone: input.timeZone }),
        ...(input.endsAt === undefined ? {} : { endsAt: input.endsAt }),
        ...(input.maxRuns === undefined ? {} : { maxRuns: input.maxRuns }),
        ...(input.notificationPolicy === undefined
          ? {}
          : { notificationPolicy: input.notificationPolicy }),
        heartbeat: input.heartbeat ? exportedHeartbeat(input.heartbeat) : null,
      }),
    )
    expect(
      printedScheduledTasksExport([
        fromPartial<ScheduledTasksResponse>({ outcome: { effect: 'listed', tasks } }),
      ]),
    ).toEqual(value)
  },
}

const PAGES: Readonly<Record<string, readonly ExampleKind[]>> = {
  'configuration/project-actions.md': [actionsFile],
  'configuration/per-project-config.md': [vscodeSchemaAssociation, settingsFile],
  'configuration/mcp.md': [mcpFile],
  'configuration/mcp-reference.md': [mcpFile],
  'using-openwaggle/waggle-mode.md': [wagglePresetsFile],
  'providers/custom-providers.md': [piModelsFile],
  'using-openwaggle/scheduled-tasks-reference.md': [scheduledTasksExport],
}

async function jsonExamples(page: string) {
  return (await fencedBlocks(page)).filter((block) => block.language === 'json')
}

function parseExample(page: string, block: FencedBlock): unknown {
  try {
    return JSON.parse(block.code)
  } catch (error) {
    throw new Error(`${page}:${String(block.line)} is not valid JSON`, { cause: error })
  }
}

describe('JSON examples in the configuration docs', () => {
  for (const [page, kinds] of Object.entries(PAGES)) {
    it(`${page} has only examples its readers accept`, async () => {
      const blocks = await jsonExamples(page)
      expect(blocks.length, page).toBeGreaterThan(0)
      for (const block of blocks) {
        const value = parseExample(page, block)
        const kind = kinds.find((candidate) => candidate.matches(value))
        if (!kind) throw new Error(`${page}:${String(block.line)} matches no known file format.`)
        await kind.check(value).catch((error: unknown) => {
          throw new Error(`${page}:${String(block.line)} is not a valid ${kind.name} example`, {
            cause: error,
          })
        })
      }
    })
  }
})

describe('the codemode docs example', () => {
  it('is a script that reads files in parallel and prints only a summary', async () => {
    const [script] = (await fencedBlocks('using-openwaggle/codemode.md')).filter(
      (block) => block.language === 'js',
    )
    if (!script) throw new Error('codemode.md has no js example.')
    const reads: string[] = []
    const printed: string[] = []
    const tools = {
      // Pi's read tool takes one object; `path` is its only required argument.
      read: async (args: unknown) => {
        const filePath = record(args)['path']
        if (typeof filePath !== 'string') throw new Error('read needs { path }.')
        reads.push(filePath)
        return `import x from 'y'\nthrow new Error('${filePath}')\nreturn 1\n`
      },
    }
    // Codemode runs the script as the body of an async function with these globals.
    const AsyncFunction = Object.getPrototypeOf(async () => undefined).constructor
    const run: unknown = new AsyncFunction('tools', 'text', script.code)
    if (typeof run !== 'function') throw new Error('The script did not compile.')
    await run(tools, (value: string) => printed.push(value))
    expect(reads.length).toBeGreaterThan(1)
    expect(printed).toHaveLength(reads.length)
    expect(printed[0]).toContain('2: throw new Error')
  })
})

describe('published schema URLs in the docs', () => {
  it('name files the website publishes', async () => {
    const docsRoot = path.join(REPOSITORY_ROOT, 'website/src/content/docs')
    const published = await readdir(path.join(REPOSITORY_ROOT, 'website/public/schemas'))
    const pages = (await readdir(docsRoot, { recursive: true })).filter((file) =>
      /\.mdx?$/u.test(file),
    )
    const named = new Set<string>()
    for (const page of pages) {
      const markdown = await readFile(path.join(docsRoot, page), 'utf8')
      for (const match of markdown.matchAll(
        /https:\/\/openwaggle\.ai\/schemas\/([\w.-]+\.json)/gu,
      )) {
        named.add(match[1] ?? '')
      }
    }
    expect(named.size).toBeGreaterThan(0)
    for (const fileName of named) expect(published, fileName).toContain(fileName)
  })
})
