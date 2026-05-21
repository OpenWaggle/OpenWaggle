import { createRequire } from 'node:module'
import path from 'node:path'
import {
  MCP_ADAPTER_PACKAGE_NAME,
  MCP_ADAPTER_PACKAGE_SOURCE,
  MCP_ADAPTER_PACKAGE_SOURCES,
  MCP_ADAPTER_PACKAGE_VERSION,
} from '@shared/constants/mcp'
import bundledMcpAdapterPackage from 'pi-mcp-adapter/package.json'
import { createLogger } from '../../../logger'

export const logger = createLogger('pi-mcp-config')
export const requireFromPiMcpConfigService = createRequire(import.meta.url)
export const MCP_ADAPTER_PACKAGE_JSON = `${MCP_ADAPTER_PACKAGE_NAME}/package.json`
export const BUNDLED_MCP_ADAPTER_VERSION = bundledMcpAdapterPackage.version
export const ASAR_PATH_SEGMENT = `${path.sep}app.asar${path.sep}`
export const ASAR_UNPACKED_PATH_SEGMENT = `${path.sep}app.asar.unpacked${path.sep}`
export const MCP_ADAPTER_PACKAGE_SOURCE_SET = new Set<string>(MCP_ADAPTER_PACKAGE_SOURCES)
export { MCP_ADAPTER_PACKAGE_NAME, MCP_ADAPTER_PACKAGE_SOURCE, MCP_ADAPTER_PACKAGE_VERSION }
