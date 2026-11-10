import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { safeDecodeUnknown } from '@shared/schema'
import { actionRelativePathSchema } from '@shared/schemas/action-definitions'
import { projectSettingsFileSchema } from '@shared/schemas/validation'
import { afterEach, describe, expect, it } from 'vitest'
import { updateProjectConfig } from '../../src/main/config/project-config'
import { parseProjectSourceControlConfig } from '../../src/main/config/project-source-control-config'
import { stalePublishedJsonSchemas } from '../generate-published-json-schemas'
import { PUBLISHED_JSON_SCHEMAS, PUBLISHED_SCHEMA_DIRECTORY } from '../published-json-schemas'
import { SETTINGS_OPEN_OBJECT_KEYS } from '../published-json-schemas-settings'
import {
  patternOf,
  publishedSchemaErrors,
  REPOSITORY_ROOT,
  readActionsFileAtRuntime,
  readPublishedSchema,
  readSettingsFileAtRuntime,
  record,
  removeScratchDirectories,
  runtimeRejection,
  scratchDirectory,
} from './published-json-schemas.test-harness'

const ACTIONS = 'project-actions-v1.schema.json'
const SETTINGS = 'project-settings.schema.json'

afterEach(removeScratchDirectories)

describe('published JSON Schemas', () => {
  it('match what the runtime schemas generate', async () => {
    expect(await stalePublishedJsonSchemas(REPOSITORY_ROOT)).toEqual([])
  })

  it('are the only generated files in the schema directory', async () => {
    const files = await readdir(path.join(REPOSITORY_ROOT, PUBLISHED_SCHEMA_DIRECTORY))
    // The Agent definition schema is hand-written; agent-definition-published-schema.unit.test.ts checks it.
    expect(files.filter((file) => file !== 'agent-definition-v1.schema.json').sort()).toEqual(
      PUBLISHED_JSON_SCHEMAS.map((schema) => schema.fileName).sort(),
    )
  })

  it('describe every top-level settings key the runtime reads, with open objects open', async () => {
    const properties = record(record(await readPublishedSchema(SETTINGS))['properties'])
    expect(Object.keys(properties).sort()).toEqual(
      ['$schema', ...Object.keys(projectSettingsFileSchema.fields)].sort(),
    )
    for (const key of SETTINGS_OPEN_OBJECT_KEYS) {
      const nested = { [key]: { anything: [1, { deep: true }] } }
      expect(safeDecodeUnknown(projectSettingsFileSchema, nested).success, key).toBe(true)
      expect(await publishedSchemaErrors(SETTINGS, nested), key).toEqual([])
    }
  })
})

const action = {
  id: 'test',
  name: 'Run tests',
  icon: 'test',
  invocation: { type: 'command', command: 'pnpm test', directory: '.' },
  kind: 'task',
  allowConcurrent: false,
  autoOpenPreview: false,
}
const manifest = (overrides: Record<string, unknown>) => ({
  version: 1,
  actions: [action],
  profiles: [],
  preparation: [],
  ...overrides,
})

describe('the actions.json schema agrees with the runtime reader', () => {
  it.each([
    ['a minimal file', manifest({})],
    ['an empty file', manifest({ actions: [] })],
    [
      'a linked package script and a preview',
      manifest({
        actions: [
          {
            ...action,
            invocation: {
              type: 'task',
              task: {
                provider: 'package-script',
                source: 'packages/web/package.json',
                task: 'dev',
                directory: 'packages/web',
              },
            },
            kind: 'service',
            autoOpenPreview: true,
            previewUrl: 'http://localhost:5173',
            shortcutRules: [{ shortcut: { key: 'r', mod: true, shift: true }, order: 1 }],
          },
        ],
      }),
    ],
    [
      'setup and cleanup in a shared profile',
      manifest({
        profiles: [{ id: 'docs', name: 'Docs' }],
        preparation: [
          {
            id: 'setup',
            profileId: 'docs',
            phase: 'setup',
            invocation: { type: 'command', command: 'pnpm install', directory: '.' },
          },
          {
            id: 'cleanup',
            profileId: 'default',
            phase: 'cleanup',
            invocation: { type: 'command', command: 'docker compose down', directory: 'infra' },
          },
        ],
      }),
    ],
  ])('accepts %s', async (_name, file) => {
    expect(await publishedSchemaErrors(ACTIONS, file)).toEqual([])
    await expect(readActionsFileAtRuntime(file)).resolves.toBeDefined()
  })

  it.each([
    [
      'a $schema key',
      { $schema: 'https://openwaggle.ai/schemas/project-actions-v1.schema.json', ...manifest({}) },
      /\["\$schema"\][\s\S]*is unexpected/u,
    ],
    [
      'an unknown action key',
      manifest({ actions: [{ ...action, cwd: '.' }] }),
      /\["cwd"\][\s\S]*is unexpected/u,
    ],
    [
      'a missing preparation list',
      { version: 1, actions: [], profiles: [] },
      /\["preparation"\][\s\S]*is missing/u,
    ],
    ['version 2', manifest({ version: 2 }), /\["version"\][\s\S]*Expected 1, actual 2/u],
    [
      'a service that allows copies',
      manifest({ actions: [{ ...action, kind: 'service', allowConcurrent: true }] }),
      /\[0\][\s\S]*Predicate refinement failure[\s\S]*"kind":"service","allowConcurrent":true/u,
    ],
    [
      'a blank name',
      manifest({ actions: [{ ...action, name: '   ' }] }),
      /\["name"\][\s\S]*actual " {3}"/u,
    ],
    [
      'an unknown icon',
      manifest({ actions: [{ ...action, icon: 'rocket' }] }),
      /\["icon"\][\s\S]*actual "rocket"/u,
    ],
    [
      'a folder outside the workspace',
      manifest({
        actions: [{ ...action, invocation: { ...action.invocation, directory: '../other' } }],
      }),
      /\["directory"\][\s\S]*actual "\.\.\/other"/u,
    ],
    [
      'an id with a space',
      manifest({ actions: [{ ...action, id: 'run tests' }] }),
      /\["id"\][\s\S]*actual "run tests"/u,
    ],
  ])('rejects %s', async (_name, file, reason) => {
    expect(await publishedSchemaErrors(ACTIONS, file)).not.toEqual([])
    // The reader must reject the file for this reason, not for an unrelated mistake in the case.
    expect(await runtimeRejection(() => readActionsFileAtRuntime(file))).toMatch(reason)
  })

  it('has the folder pattern of actionRelativePathSchema', async () => {
    const folder = await patternOf(ACTIONS, [
      'properties',
      'actions',
      'items',
      'properties',
      'invocation',
      'anyOf',
      '0',
      'properties',
      'directory',
    ])
    for (const candidate of [
      '.',
      'apps/web',
      'a/b/c',
      '.config',
      'a/.b',
      'a..b',
      './a',
      'a/./b',
      '..',
      'a/..',
      '/abs',
      'a//b',
      'a/',
      'C:/x',
      'a\\b',
      '',
    ]) {
      expect(folder.test(candidate), candidate).toBe(
        safeDecodeUnknown(actionRelativePathSchema, candidate).success,
      )
    }
  })
})

describe('the settings.json schema agrees with the runtime reader', () => {
  it.each([
    ['an empty file', {}],
    [
      'every OpenWaggle key',
      {
        $schema: 'https://openwaggle.ai/schemas/project-settings.schema.json',
        preferences: { authorizationMode: 'ask-for-approval' },
        sessionHost: { multiAgentEnabled: true, parentConcurrencyLimit: 4 },
        pi: { compaction: { enabled: true } },
        sourceControl: { hosts: { 'git.acme.io': 'gitlab' } },
      },
    ],
  ])('accepts %s', async (_name, file) => {
    expect(await publishedSchemaErrors(SETTINGS, file)).toEqual([])
    await expect(readSettingsFileAtRuntime(file)).resolves.toBeDefined()
  })

  it.each([
    [
      'an unknown access mode',
      { preferences: { authorizationMode: 'read-only' } },
      /preferences\.authorizationMode: Expected "yolo", actual "read-only"/u,
    ],
    [
      'a zero Worker limit',
      { sessionHost: { parentConcurrencyLimit: 0 } },
      /sessionHost\.parentConcurrencyLimit: Must be a positive safe integer/u,
    ],
    [
      'a fractional Worker limit',
      { sessionHost: { parentConcurrencyLimit: 1.5 } },
      /sessionHost\.parentConcurrencyLimit: Must be a positive safe integer/u,
    ],
    ['a pi value that is not an object', { pi: [] }, /pi: Expected \{[^}]*\}, actual \[\]/u],
  ])('rejects %s', async (_name, file, reason) => {
    expect(await publishedSchemaErrors(SETTINGS, file)).not.toEqual([])
    expect(await runtimeRejection(() => readSettingsFileAtRuntime(file))).toMatch(reason)
  })

  it('lists exactly the source-control values the runtime keeps', async () => {
    const settings = record(record(await readPublishedSchema(SETTINGS))['properties'])
    const properties = record(record(settings['sourceControl'])['properties'])
    const providers = record(record(properties['hosts'])['additionalProperties'])['enum']
    const destinations = record(properties['changeRequestOpenDestination'])['enum']
    if (!Array.isArray(providers) || !Array.isArray(destinations)) {
      throw new Error('The sourceControl enums are missing.')
    }
    for (const provider of [...providers, 'bitbucket', 'unsupported']) {
      const { hosts } = parseProjectSourceControlConfig(
        { hosts: { 'git.acme.io': provider } },
        '/p',
      )
      expect(hosts['git.acme.io'] === provider, String(provider)).toBe(providers.includes(provider))
    }
    for (const destination of [...destinations, 'browser']) {
      const parsed = parseProjectSourceControlConfig(
        { changeRequestOpenDestination: destination },
        '/p',
      )
      expect(parsed.changeRequestOpenDestination === destination, String(destination)).toBe(
        destinations.includes(destination),
      )
    }
  })

  it('keeps a $schema key when OpenWaggle rewrites the file', async () => {
    const project = scratchDirectory('ow-settings-schema-key-')
    const schemaUrl = 'https://openwaggle.ai/schemas/project-settings.schema.json'
    const settingsPath = path.join(project, '.openwaggle', 'settings.json')
    await mkdir(path.dirname(settingsPath))
    await writeFile(settingsPath, JSON.stringify({ $schema: schemaUrl }))
    await updateProjectConfig(project, (current) => ({
      ...current,
      sessionHost: { multiAgentEnabled: true },
    }))
    expect(record(JSON.parse(await readFile(settingsPath, 'utf8')))).toEqual({
      $schema: schemaUrl,
      sessionHost: { multiAgentEnabled: true },
    })
  })
})
