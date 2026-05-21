import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { MCP_CONFIG } from '@shared/constants/mcp'
import { decodeUnknownOrThrow } from '@shared/schema'
import { mcpConfigFileSchema, piAgentSettingsFileSchema } from '@shared/schemas/mcp'
import type { McpConfigFile, PiAgentSettingsFile } from '@shared/types/mcp'
import { logger } from './constants'

function isEnoent(error: unknown) {
  return (
    error instanceof Error &&
    'code' in error &&
    typeof error.code === 'string' &&
    error.code === 'ENOENT'
  )
}

export async function readTextIfPresent(filePath: string) {
  try {
    return await readFile(filePath, 'utf-8')
  } catch (error) {
    if (isEnoent(error)) {
      return null
    }
    throw error
  }
}

export function parseMcpConfigFile(rawJson: string | null) {
  if (!rawJson || rawJson.trim().length === 0) {
    return {}
  }
  const parsed: unknown = JSON.parse(rawJson)
  return decodeUnknownOrThrow(mcpConfigFileSchema, parsed)
}

function parsePiAgentSettingsFile(rawJson: string | null) {
  if (!rawJson || rawJson.trim().length === 0) {
    return {}
  }
  const parsed: unknown = JSON.parse(rawJson)
  return decodeUnknownOrThrow(piAgentSettingsFileSchema, parsed)
}

export function formatErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function createConfigReadError(label: string, filePath: string, error: unknown) {
  return new Error(`${label} at ${filePath}: ${formatErrorMessage(error)}`)
}

export function parseMcpConfigFileForView(filePath: string, rawJson: string | null) {
  try {
    return { config: parseMcpConfigFile(rawJson), parseError: null }
  } catch (error) {
    const message = createConfigReadError('Invalid MCP JSON config', filePath, error).message
    logger.warn('Invalid MCP JSON config', { path: filePath, error: formatErrorMessage(error) })
    return { config: {}, parseError: message }
  }
}

export function parsePiAgentSettingsFileForView(filePath: string, rawJson: string | null) {
  try {
    return { settings: parsePiAgentSettingsFile(rawJson), parseError: null }
  } catch (error) {
    const message = createConfigReadError('Invalid Pi settings JSON', filePath, error).message
    logger.warn('Invalid Pi settings JSON', { path: filePath, error: formatErrorMessage(error) })
    return { settings: {}, parseError: message }
  }
}

export async function readMcpConfigFile(filePath: string) {
  try {
    return parseMcpConfigFile(await readTextIfPresent(filePath))
  } catch (error) {
    logger.warn('Invalid MCP JSON config', { path: filePath, error: formatErrorMessage(error) })
    throw createConfigReadError('Invalid MCP JSON config', filePath, error)
  }
}

export async function readPiAgentSettingsFile(filePath: string) {
  try {
    return parsePiAgentSettingsFile(await readTextIfPresent(filePath))
  } catch (error) {
    logger.warn('Invalid Pi settings JSON', { path: filePath, error: formatErrorMessage(error) })
    throw createConfigReadError('Invalid Pi settings JSON', filePath, error)
  }
}

export async function writeJsonFile(filePath: string, value: McpConfigFile | PiAgentSettingsFile) {
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
