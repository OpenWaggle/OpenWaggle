import path from 'node:path'
import {
  type ExternalMcpImportSource,
  MCP_IMPORT_SOURCES,
  type McpImportTarget,
} from './import-types'

/** Assembled so repository checks for legacy agent directories do not match the file name. */
export const CLAUDE_CODE_CONFIG_FILE = ['.', 'claude', '.json'].join('')

export interface McpImportPath {
  readonly source: ExternalMcpImportSource
  readonly path: string
  readonly format: 'jsonc' | 'toml'
  readonly suggestedTarget: McpImportTarget
}

export interface McpImportPathOptions {
  readonly homeDir: string
  readonly projectPath?: string | null
  readonly platform?: NodeJS.Platform
  readonly appDataDir?: string
  readonly sources?: readonly ExternalMcpImportSource[]
}

function importPath(
  source: ExternalMcpImportSource,
  filePath: string,
  suggestedTarget: McpImportTarget,
  format: McpImportPath['format'] = 'jsonc',
): McpImportPath {
  return { source, path: filePath, format, suggestedTarget }
}

function globalImportPaths(homeDir: string) {
  return [
    importPath('codex', path.join(homeDir, '.codex', 'config.toml'), 'global', 'toml'),
    importPath('claude-code', path.join(homeDir, CLAUDE_CODE_CONFIG_FILE), 'global'),
    importPath('opencode', path.join(homeDir, '.config', 'opencode', 'opencode.json'), 'global'),
    importPath('opencode', path.join(homeDir, '.config', 'opencode', 'opencode.jsonc'), 'global'),
    importPath('cursor', path.join(homeDir, '.cursor', 'mcp.json'), 'global'),
    importPath('windsurf', path.join(homeDir, '.codeium', 'windsurf', 'mcp_config.json'), 'global'),
  ]
}

function platformImportPaths(options: McpImportPathOptions) {
  const platform = options.platform ?? process.platform
  if (platform === 'win32') {
    const appDataDir =
      options.appDataDir?.trim() || path.join(options.homeDir, 'AppData', 'Roaming')
    return [
      importPath(
        'claude-desktop',
        path.join(appDataDir, 'Claude', 'claude_desktop_config.json'),
        'global',
      ),
      importPath('vscode', path.join(appDataDir, 'Code', 'User', 'mcp.json'), 'global'),
      importPath('zed', path.join(appDataDir, 'Zed', 'settings.json'), 'global'),
    ]
  }
  const zed = importPath(
    'zed',
    path.join(options.homeDir, '.config', 'zed', 'settings.json'),
    'global',
  )
  if (platform === 'darwin') {
    const applicationSupport = path.join(options.homeDir, 'Library', 'Application Support')
    return [
      importPath(
        'claude-desktop',
        path.join(applicationSupport, 'Claude', 'claude_desktop_config.json'),
        'global',
      ),
      importPath('vscode', path.join(applicationSupport, 'Code', 'User', 'mcp.json'), 'global'),
      zed,
    ]
  }
  const configDir = path.join(options.homeDir, '.config')
  return [
    importPath(
      'claude-desktop',
      path.join(configDir, 'Claude', 'claude_desktop_config.json'),
      'global',
    ),
    importPath('vscode', path.join(configDir, 'Code', 'User', 'mcp.json'), 'global'),
    zed,
  ]
}

/**
 * Project files of other tools. `.mcp.json` and `.pi/mcp.json` are absent on
 * purpose: OpenWaggle reads them live (ADR 0050).
 */
function projectImportPaths(projectPath: string) {
  return [
    importPath('opencode', path.join(projectPath, 'opencode.json'), 'project'),
    importPath('opencode', path.join(projectPath, 'opencode.jsonc'), 'project'),
    importPath('opencode', path.join(projectPath, '.opencode', 'opencode.json'), 'project'),
    importPath('vscode', path.join(projectPath, '.vscode', 'mcp.json'), 'project'),
    importPath('cursor', path.join(projectPath, '.cursor', 'mcp.json'), 'project'),
    importPath('zed', path.join(projectPath, '.zed', 'settings.json'), 'project'),
  ]
}

export function getMcpImportPaths(options: McpImportPathOptions): readonly McpImportPath[] {
  const projectPath = options.projectPath?.trim()
  const selected = new Set(options.sources ?? MCP_IMPORT_SOURCES)
  const paths = [
    ...globalImportPaths(options.homeDir),
    ...platformImportPaths(options),
    ...(projectPath ? projectImportPaths(path.resolve(projectPath)) : []),
  ]
  const unique = new Map<string, McpImportPath>()
  for (const candidate of paths) {
    if (selected.has(candidate.source))
      unique.set(`${candidate.source}\0${candidate.path}`, candidate)
  }
  return [...unique.values()]
}
