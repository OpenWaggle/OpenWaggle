import { cp as copyDirectory, mkdir, readFile, rm } from 'node:fs/promises'
import path from 'node:path'
import { getAgentDir } from '@earendil-works/pi-coding-agent'
import { parseJsonUnknown } from '@shared/schema'
import {
  ASAR_PATH_SEGMENT,
  ASAR_UNPACKED_PATH_SEGMENT,
  BUNDLED_MCP_ADAPTER_VERSION,
  MCP_ADAPTER_PACKAGE_JSON,
  MCP_ADAPTER_PACKAGE_NAME,
  MCP_ADAPTER_PACKAGE_SOURCE,
  MCP_ADAPTER_PACKAGE_SOURCE_SET,
  MCP_ADAPTER_PACKAGE_VERSION,
  requireFromPiMcpConfigService,
} from './constants'

function isJsonRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readJsonObjectProperty(value: Readonly<Record<string, unknown>>, property: string) {
  return value[property]
}

function readPackageJsonVersion(content: string) {
  const parsed = parseJsonUnknown(content)
  if (!isJsonRecord(parsed)) {
    return null
  }

  const version = readJsonObjectProperty(parsed, 'version')
  return typeof version === 'string' ? version : null
}

async function readPackageVersion(packageDir: string) {
  try {
    return readPackageJsonVersion(await readFile(path.join(packageDir, 'package.json'), 'utf-8'))
  } catch {
    return null
  }
}

export function resolveCopyableBundledMcpAdapterPackageDir(packageDir: string) {
  if (!packageDir.includes(ASAR_PATH_SEGMENT)) {
    return packageDir
  }

  return packageDir.replace(ASAR_PATH_SEGMENT, ASAR_UNPACKED_PATH_SEGMENT)
}

function getBundledMcpAdapterPackageDir() {
  return resolveCopyableBundledMcpAdapterPackageDir(
    path.dirname(requireFromPiMcpConfigService.resolve(MCP_ADAPTER_PACKAGE_JSON)),
  )
}

function bundledMcpAdapterMatchesSource(source: string) {
  return (
    MCP_ADAPTER_PACKAGE_SOURCE_SET.has(source) &&
    BUNDLED_MCP_ADAPTER_VERSION === MCP_ADAPTER_PACKAGE_VERSION
  )
}

async function installedMcpAdapterMatchesSource(source: string, installedPath: string) {
  return (
    MCP_ADAPTER_PACKAGE_SOURCE_SET.has(source) &&
    (await readPackageVersion(installedPath)) === MCP_ADAPTER_PACKAGE_VERSION
  )
}

async function installBundledMcpAdapterPackage(source: string, agentDir: string) {
  const installedPath = path.join(agentDir, MCP_ADAPTER_PACKAGE_SOURCE)
  if (await installedMcpAdapterMatchesSource(source, installedPath)) {
    return
  }

  const bundledPath = getBundledMcpAdapterPackageDir()
  if (!bundledMcpAdapterMatchesSource(source)) {
    throw new Error(`Bundled ${MCP_ADAPTER_PACKAGE_NAME} version does not match ${source}`)
  }

  await rm(installedPath, { recursive: true, force: true })
  await mkdir(path.dirname(installedPath), { recursive: true })
  await copyDirectory(bundledPath, installedPath, { recursive: true, dereference: true })
}

export async function installMcpAdapterPackage(source: string) {
  const agentDir = getAgentDir()
  await mkdir(agentDir, { recursive: true })
  await installBundledMcpAdapterPackage(source, agentDir)
}
