import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

const requireFromBundle = createRequire(__filename)
const PI_MCP_ADAPTER_PACKAGE = 'pi-mcp-adapter/package.json'
const PI_MCP_ADAPTER_EXTENSION_ENTRY = 'index.ts'

let cachedMcpAdapterExtensionPath: string | null = null

export function resolvePiMcpAdapterExtensionPath(): string {
  if (cachedMcpAdapterExtensionPath) {
    return cachedMcpAdapterExtensionPath
  }

  const packageJsonPath = requireFromBundle.resolve(PI_MCP_ADAPTER_PACKAGE)
  const extensionPath = join(dirname(packageJsonPath), PI_MCP_ADAPTER_EXTENSION_ENTRY)
  if (!existsSync(extensionPath)) {
    throw new Error(`OpenWaggle MCP adapter extension is missing at ${extensionPath}`)
  }

  cachedMcpAdapterExtensionPath = extensionPath
  return extensionPath
}

export function getOpenWaggleCorePiExtensionPaths(input: {
  readonly mcpEnabled: boolean
}): readonly string[] {
  return input.mcpEnabled ? [resolvePiMcpAdapterExtensionPath()] : []
}
