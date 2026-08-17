import path from 'node:path'
import type { McpImportSource } from '@shared/types/mcp'

const CLAUDE_CODE_CONFIG_FILE = ['.', 'claude', '.json'].join('')

export const ALL_IMPORT_SOURCES: readonly McpImportSource[] = [
  'codex',
  'claude-code',
  'claude-desktop',
  'opencode',
  'pi',
  'vscode',
  'cursor',
  'windsurf',
  'zed',
]

export interface ImportPath {
  readonly source: McpImportSource
  readonly path: string
  readonly format: 'jsonc' | 'toml'
  readonly suggestedTarget: 'global' | 'project'
  readonly selection?: 'all' | 'legacy-disabled-only'
}

export interface ImportOptions {
  readonly homeDir: string
  readonly projectPath?: string | null
  readonly platform?: NodeJS.Platform
  readonly appDataDir?: string
  readonly sources?: readonly McpImportSource[]
}

function importPath(
  source: McpImportSource,
  filePath: string,
  suggestedTarget: ImportPath['suggestedTarget'],
  format: ImportPath['format'] = 'jsonc',
  selection?: ImportPath['selection'],
): ImportPath {
  return { source, path: filePath, format, suggestedTarget, ...(selection ? { selection } : {}) }
}

function globalImportPaths(homeDir: string) {
  return [
    importPath('codex', path.join(homeDir, '.codex', 'config.toml'), 'global', 'toml'),
    importPath('claude-code', path.join(homeDir, CLAUDE_CODE_CONFIG_FILE), 'global'),
    importPath('opencode', path.join(homeDir, '.config', 'opencode', 'opencode.json'), 'global'),
    importPath('opencode', path.join(homeDir, '.config', 'opencode', 'opencode.jsonc'), 'global'),
    importPath('pi', path.join(homeDir, '.config', 'mcp', 'mcp.json'), 'global'),
    importPath('pi', path.join(homeDir, '.pi', 'agent', 'mcp.json'), 'global'),
    importPath('cursor', path.join(homeDir, '.cursor', 'mcp.json'), 'global'),
    importPath('windsurf', path.join(homeDir, '.codeium', 'windsurf', 'mcp_config.json'), 'global'),
    importPath('zed', path.join(homeDir, '.config', 'zed', 'settings.json'), 'global'),
  ]
}

function platformImportPaths(options: ImportOptions) {
  const platform = options.platform ?? process.platform
  if (platform === 'darwin') {
    const applicationSupport = path.join(options.homeDir, 'Library', 'Application Support')
    return [
      importPath(
        'claude-desktop',
        path.join(applicationSupport, 'Claude', 'claude_desktop_config.json'),
        'global',
      ),
      importPath('vscode', path.join(applicationSupport, 'Code', 'User', 'mcp.json'), 'global'),
    ]
  }
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
    ]
  }
  return [
    importPath(
      'claude-desktop',
      path.join(options.homeDir, '.config', 'Claude', 'claude_desktop_config.json'),
      'global',
    ),
    importPath(
      'vscode',
      path.join(options.homeDir, '.config', 'Code', 'User', 'mcp.json'),
      'global',
    ),
  ]
}

function projectImportPaths(projectPath: string) {
  return [
    importPath('opencode', path.join(projectPath, 'opencode.json'), 'project'),
    importPath('opencode', path.join(projectPath, 'opencode.jsonc'), 'project'),
    importPath('opencode', path.join(projectPath, '.opencode', 'opencode.json'), 'project'),
    importPath(
      'pi',
      path.join(projectPath, '.mcp.json'),
      'project',
      'jsonc',
      'legacy-disabled-only',
    ),
    importPath('pi', path.join(projectPath, '.agents', 'mcp.json'), 'project'),
    importPath('pi', path.join(projectPath, '.pi', 'mcp.json'), 'project'),
    importPath('pi', path.join(projectPath, '.openwaggle', 'agent', 'mcp.json'), 'project'),
    importPath('vscode', path.join(projectPath, '.vscode', 'mcp.json'), 'project'),
    importPath('cursor', path.join(projectPath, '.cursor', 'mcp.json'), 'project'),
    importPath('zed', path.join(projectPath, '.zed', 'settings.json'), 'project'),
  ]
}

export function getMcpImportPaths(options: ImportOptions): readonly ImportPath[] {
  const projectPath = options.projectPath?.trim()
  const paths = [
    ...globalImportPaths(options.homeDir),
    ...platformImportPaths(options),
    ...(projectPath ? projectImportPaths(projectPath) : []),
  ]
  const selected = new Set(options.sources ?? ALL_IMPORT_SOURCES)
  const deduplicated = new Map<string, ImportPath>()
  for (const candidate of paths) {
    if (selected.has(candidate.source)) {
      deduplicated.set(`${candidate.source}\0${candidate.path}`, candidate)
    }
  }
  return [...deduplicated.values()]
}
