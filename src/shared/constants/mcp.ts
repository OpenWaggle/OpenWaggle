export const MCP_ADAPTER_PACKAGE_NAME = 'pi-mcp-adapter'
export const MCP_ADAPTER_PACKAGE_VERSION = '2.5.4'
export const MCP_ADAPTER_PACKAGE_SOURCE = `extensions/${MCP_ADAPTER_PACKAGE_NAME}`
export const MCP_ADAPTER_PACKAGE_SOURCES = [MCP_ADAPTER_PACKAGE_SOURCE] as const

export const MCP_CONFIG = {
  JSON_INDENT_SPACES: 2,
  CONFIG_HASH_PREFIX_LENGTH: 16,
  GENERATED_CONFIG_DIR: 'openwaggle-mcp',
  GENERATED_ADAPTER_CWD_DIR: 'adapter-cwd',
  NPM_CACHE_DIR: 'npm-cache',
  GLOBAL_STANDARD_CONFIG_DIR: ['.config', 'mcp'],
  PROJECT_STANDARD_CONFIG_FILE_NAME: '.mcp.json',
  PROJECT_AGENTS_CONFIG_DIR: '.agents',
  PROJECT_PI_CONFIG_DIR: '.pi',
  PROJECT_OPENWAGGLE_CONFIG_DIR: ['.openwaggle', 'agent'],
  CONFIG_FILE_NAME: 'mcp.json',
  SETTINGS_FILE_NAME: 'settings.json',
  OPENWAGGLE_KEY: 'openwaggle',
  DISABLED_SERVERS_KEY: 'disabledMcpServers',
  ARG_CONFIG_FLAG: '--mcp-config',
  EMPTY_CONFIG_RAW_JSON: '{\n  "mcpServers": {}\n}\n',
} as const
