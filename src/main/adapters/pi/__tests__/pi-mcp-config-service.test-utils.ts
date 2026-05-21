import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { MCP_CONFIG } from '@shared/constants/mcp'
import { decodeUnknownOrThrow } from '@shared/schema'
import { mcpConfigFileSchema, piAgentSettingsFileSchema } from '@shared/schemas/mcp'
import type { McpConfigFile, PiAgentSettingsFile } from '@shared/types/mcp'

export interface McpFixture {
  readonly root: string
  readonly home: string
  readonly agentDir: string
  readonly project: string
}

export async function writeJson(filePath: string, value: McpConfigFile | PiAgentSettingsFile) {
  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(
    filePath,
    `${JSON.stringify(value, null, MCP_CONFIG.JSON_INDENT_SPACES)}\n`,
    'utf-8',
  )
}

export async function writeText(filePath: string, value: string) {
  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(filePath, value, 'utf-8')
}

export async function readMcpConfig(filePath: string) {
  const parsed: unknown = JSON.parse(await readFile(filePath, 'utf-8'))
  return decodeUnknownOrThrow(mcpConfigFileSchema, parsed)
}

export async function readPiSettings(filePath: string) {
  const parsed: unknown = JSON.parse(await readFile(filePath, 'utf-8'))
  return decodeUnknownOrThrow(piAgentSettingsFileSchema, parsed)
}

export function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export async function withFixture<T>(fn: (fixture: McpFixture) => Promise<T>) {
  const root = await mkdtemp(path.join(tmpdir(), 'openwaggle-mcp-'))
  const fixture = {
    root,
    home: path.join(root, 'home'),
    agentDir: path.join(root, 'pi-agent'),
    project: path.join(root, 'project'),
  }
  try {
    return await fn(fixture)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}
