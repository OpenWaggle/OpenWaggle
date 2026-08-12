import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { MCP_CONFIG } from '@shared/constants/mcp'
import { decodeUnknownOrThrow, Schema } from '@shared/schema'
import { mcpConfigFileSchema } from '@shared/schemas/mcp'
import type { McpConfigFile } from '@shared/types/mcp'
import { createLogger } from '../../logger'
import type { McpUserStateFile } from './config-types'

const logger = createLogger('mcp-files')

const mcpServerPermissionGrantSchema = Schema.Struct({
  readRoots: Schema.Array(Schema.String),
  writeRoots: Schema.Array(Schema.String),
  allowNetwork: Schema.Boolean,
})

const mcpServerUserStateSchema = Schema.Struct({
  instanceId: Schema.String,
  enabled: Schema.Boolean,
  trustedConfigHash: Schema.optional(Schema.String),
  allowUnsandboxed: Schema.optional(Schema.Boolean),
  permissions: Schema.optional(mcpServerPermissionGrantSchema),
})

const mcpScopeStateRecordSchema = Schema.Record({
  key: Schema.String,
  value: Schema.Literal('inherit', 'on', 'off'),
})

const mcpProjectServerStatesSchema = Schema.Record({
  key: Schema.String,
  value: Schema.Record({ key: Schema.String, value: Schema.Literal('on', 'off') }),
})

const mcpUserStateFileSchema = Schema.Struct({
  version: Schema.Number,
  globalState: Schema.Literal('on', 'off'),
  projectStates: mcpScopeStateRecordSchema,
  sessionStates: mcpScopeStateRecordSchema,
  // Optional for back-compat with state files written before per-project server
  // overrides existed; defaults to an empty map.
  projectServerStates: Schema.optionalWith(mcpProjectServerStatesSchema, {
    default: () => ({}),
  }),
  servers: Schema.Record({ key: Schema.String, value: mcpServerUserStateSchema }),
})

function isEnoent(error: unknown) {
  return (
    error instanceof Error &&
    'code' in error &&
    typeof error.code === 'string' &&
    error.code === 'ENOENT'
  )
}

export function describeMcpError(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

export async function readTextIfPresent(filePath: string) {
  try {
    return await readFile(filePath, 'utf-8')
  } catch (error) {
    if (isEnoent(error)) return null
    throw error
  }
}

export function parseMcpConfigFile(rawJson: string | null) {
  if (!rawJson?.trim()) return {}
  const parsed: unknown = JSON.parse(rawJson)
  return decodeUnknownOrThrow(mcpConfigFileSchema, parsed)
}

export function parseMcpConfigFileForView(filePath: string, rawJson: string | null) {
  try {
    return { config: parseMcpConfigFile(rawJson), parseError: null }
  } catch (error) {
    const parseError = `Invalid MCP JSON config at ${filePath}: ${describeMcpError(error)}`
    logger.warn('Invalid MCP JSON config', { path: filePath, error: describeMcpError(error) })
    return { config: {}, parseError }
  }
}

export function createDefaultMcpUserState(): McpUserStateFile {
  return {
    version: MCP_CONFIG.STATE_VERSION,
    globalState: 'off',
    projectStates: {},
    sessionStates: {},
    projectServerStates: {},
    servers: {},
  }
}

export async function readMcpUserState(filePath: string) {
  const rawJson = await readTextIfPresent(filePath)
  if (!rawJson?.trim()) return createDefaultMcpUserState()
  try {
    const parsed: unknown = JSON.parse(rawJson)
    return decodeUnknownOrThrow(mcpUserStateFileSchema, parsed)
  } catch (error) {
    throw new Error(`Invalid OpenWaggle MCP state at ${filePath}: ${describeMcpError(error)}`, {
      cause: error,
    })
  }
}

export async function writeJsonFileAtomic(
  filePath: string,
  value: McpConfigFile | McpUserStateFile,
) {
  await mkdir(path.dirname(filePath), { recursive: true })
  const tempPath = `${filePath}.${randomUUID()}.tmp`
  try {
    await writeFile(
      tempPath,
      `${JSON.stringify(value, null, MCP_CONFIG.JSON_INDENT_SPACES)}\n`,
      'utf-8',
    )
    await rename(tempPath, filePath)
  } catch (error) {
    await rm(tempPath, { force: true }).catch(() => undefined)
    throw error
  }
}
