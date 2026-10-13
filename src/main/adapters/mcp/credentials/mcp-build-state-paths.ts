import { homedir } from 'node:os'
import path from 'node:path'
import { MCP_CONFIG } from '@shared/constants/mcp'
import { app } from 'electron'

/**
 * Where this build keeps its encrypted MCP state: its user data (ADR 0032), so a dev and a release
 * build, which encrypt with different keys, never read or replace each other's sign-ins and
 * secrets.
 */
export function mcpBuildStateDirectory() {
  return path.join(app.getPath('userData'), 'mcp')
}

/** `~/.openwaggle/mcp`, which every build shared before; still the home of `mcp.log`. */
export function sharedMcpStateDirectory() {
  return path.join(homedir(), ...MCP_CONFIG.GLOBAL_STATE_DIR)
}
