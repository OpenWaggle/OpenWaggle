import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { WagglePreset } from '@openwaggle/waggle-core'
import { safeDecodeUnknown } from '@shared/schema'
import { wagglePresetSchema } from '@shared/schemas/waggle'
import JsonSchema from 'typebox/schema'
import { readPiWagglePresetsFileData } from '../../packages/pi-waggle/src/preset-storage'
import { readActionManifest } from '../../src/main/adapters/project-actions/action-manifest-file'
import { loadProjectConfigStrict } from '../../src/main/config/project-config'
import {
  type McpConfigLayer,
  mergeMcpConfigLayers,
} from '../../src/main/domain/mcp/config/mcp-config-merge'
import {
  EMPTY_ACTION_MANIFEST,
  resolveActionCatalog,
} from '../../src/main/domain/project-action-catalog'
import { PUBLISHED_SCHEMA_DIRECTORY } from '../published-json-schemas'

export const REPOSITORY_ROOT = fileURLToPath(new URL('../../', import.meta.url))

const JSON_INDENT_SPACES = 2

const scratchDirectories: string[] = []

export function scratchDirectory(prefix: string) {
  // The real path: the action manifest reader refuses a workspace reached through a link.
  const directory = realpathSync(mkdtempSync(path.join(tmpdir(), prefix)))
  scratchDirectories.push(directory)
  return directory
}

/** Removes every directory `scratchDirectory` made; call it from `afterEach`. */
export function removeScratchDirectories() {
  for (const directory of scratchDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
}

function writeJson(filePath: string, value: unknown) {
  mkdirSync(path.dirname(filePath), { recursive: true })
  writeFileSync(filePath, `${JSON.stringify(value, null, JSON_INDENT_SPACES)}\n`)
}

export async function readPublishedSchema(fileName: string) {
  const parsed: unknown = JSON.parse(
    await readFile(path.join(REPOSITORY_ROOT, PUBLISHED_SCHEMA_DIRECTORY, fileName), 'utf8'),
  )
  if (!JsonSchema.IsSchema(parsed)) throw new Error(`${fileName} is not a JSON Schema.`)
  return parsed
}

/** The published schema's errors for `value`, empty when it is valid. */
export async function publishedSchemaErrors(fileName: string, value: unknown) {
  const [, errors] = JsonSchema.Errors(await readPublishedSchema(fileName), value)
  return errors.map((error) => `${error.instancePath || '(root)'}: ${error.message}`)
}

/** Whether OpenWaggle reads `value` as `.openwaggle/actions.json`; throws its error when not. */
export async function readActionsFileAtRuntime(value: unknown) {
  const workspace = scratchDirectory('ow-actions-schema-')
  writeJson(path.join(workspace, '.openwaggle', 'actions.json'), value)
  const { manifest } = await readActionManifest(workspace)
  const local = {
    manifest: EMPTY_ACTION_MANIFEST,
    reviews: [],
    migration: { version: 1, legacySource: null },
  } as const
  return resolveActionCatalog(local, manifest, '')
}

/** Reads `value` as `.openwaggle/settings.json` the strict way permission checks do. */
export async function readSettingsFileAtRuntime(value: unknown) {
  const project = scratchDirectory('ow-settings-schema-')
  writeJson(path.join(project, '.openwaggle', 'settings.json'), value)
  return loadProjectConfigStrict(project)
}

/**
 * Merge errors for `value` as `<project>/.openwaggle/mcp.json`. With `baseNames`, an earlier
 * file defines those servers first, so override-only entries have something to change.
 */
export function mcpFileErrorsAtRuntime(value: unknown, baseNames: readonly string[] = []) {
  const layers: McpConfigLayer[] = [
    {
      fileId: 'pi-global',
      path: '/home/.pi/agent/mcp.json',
      content: {
        kind: 'parsed',
        value: {
          mcpServers: Object.fromEntries(baseNames.map((name) => [name, { command: 'base' }])),
        },
      },
    },
    {
      fileId: 'project-openwaggle',
      path: '/project/.openwaggle/mcp.json',
      content: { kind: 'parsed', value },
    },
  ]
  return mergeMcpConfigLayers(layers).errors
}

function rawPresetCount(value: unknown) {
  if (typeof value !== 'object' || value === null || !('wagglePresets' in value)) return 0
  return Array.isArray(value.wagglePresets) ? value.wagglePresets.length : 0
}

/**
 * The presets OpenWaggle keeps from `value` as a Waggle presets file: `@openwaggle/pi-waggle`
 * reads the file and skips presets it cannot parse, then the app skips any its own schema
 * rejects. `skipped` counts both.
 */
export interface RuntimeWagglePresetsFile {
  readonly presets: readonly WagglePreset[]
  readonly hiddenBuiltInPresetIds: readonly string[]
  readonly skipped: number
}

export async function readWagglePresetsFileAtRuntime(
  value: unknown,
): Promise<RuntimeWagglePresetsFile> {
  const project = scratchDirectory('ow-waggle-schema-')
  const filePath = path.join(project, '.pi', 'waggle-presets.json')
  writeJson(filePath, value)
  const data = await readPiWagglePresetsFileData(filePath)
  const kept = data.wagglePresets.filter(
    (preset) => safeDecodeUnknown(wagglePresetSchema, preset).success,
  )
  return {
    presets: kept,
    hiddenBuiltInPresetIds: data.hiddenBuiltInPresetIds,
    skipped: rawPresetCount(value) - kept.length,
  }
}

export interface FencedBlock {
  readonly language: string
  readonly code: string
  readonly line: number
}

const FENCE = /^```(\w*)[^\n]*\n([\s\S]*?)^```[ \t]*$/gmu

export async function fencedBlocks(docsPage: string): Promise<readonly FencedBlock[]> {
  const markdown = await readFile(
    path.join(REPOSITORY_ROOT, 'website/src/content/docs', docsPage),
    'utf8',
  )
  return [...markdown.matchAll(FENCE)].map((match) => ({
    language: match[1] ?? '',
    code: match[2] ?? '',
    line: markdown.slice(0, match.index).split('\n').length,
  }))
}

/**
 * Why the runtime reader rejected a file, or `null` when it read the file. Tests match the
 * reason, so a case cannot pass because the reader rejected it for an unrelated mistake.
 */
export async function runtimeRejection(read: () => Promise<unknown>): Promise<string | null> {
  try {
    await read()
    return null
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
}

export function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Expected a JSON object.')
  }
  return Object.fromEntries(Object.entries(value))
}

export async function patternOf(fileName: string, pointer: readonly string[]) {
  let node: unknown = await readPublishedSchema(fileName)
  for (const segment of pointer) {
    node = Array.isArray(node) ? node[Number(segment)] : record(node)[segment]
  }
  const pattern = record(node)['pattern']
  if (typeof pattern !== 'string') throw new Error(`No pattern at ${pointer.join('/')}.`)
  return new RegExp(pattern, 'u')
}
