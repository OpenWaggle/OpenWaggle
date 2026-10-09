import { lstatSync, readFileSync, rmdirSync, rmSync } from 'node:fs'
import path from 'node:path'
import { isJsonRecord } from '../../../domain/mcp/config/mcp-server-config'

const OPENWAGGLE_DIRECTORY = '.openwaggle'
const MCP_FILE_NAME = 'mcp.json'

/** Whether `text` holds no servers and nothing else: `{}` or `{"mcpServers": {}}`. */
function holdsNothing(text: string) {
  try {
    const parsed: unknown = JSON.parse(text)
    if (!isJsonRecord(parsed)) return false
    const { mcpServers, ...rest } = parsed
    if (Object.keys(rest).length > 0) return false
    return (
      mcpServers === undefined || (isJsonRecord(mcpServers) && Object.keys(mcpServers).length === 0)
    )
  } catch {
    return false
  }
}

/**
 * Removes a project's `.openwaggle/mcp.json` that a change left with nothing in it, and its
 * `.openwaggle` folder when that is empty too: OpenWaggle created the file for an entry that is
 * gone, and left behind it would show as a new file in the checkout. Only OpenWaggle's project
 * file, and only a plain file: Pi's and shared files, the global file (also the project file of a
 * project that is the home folder), and a symlinked file are never removed.
 */
export function removeEmptyOpenWaggleProjectFile(filePath: string, homeDir: string) {
  const directory = path.dirname(filePath)
  if (path.basename(filePath) !== MCP_FILE_NAME) return
  if (path.basename(directory) !== OPENWAGGLE_DIRECTORY) return
  if (path.resolve(directory) === path.resolve(homeDir, OPENWAGGLE_DIRECTORY)) return
  try {
    if (!lstatSync(filePath).isFile() || !holdsNothing(readFileSync(filePath, 'utf8'))) return
    rmSync(filePath)
  } catch {
    return
  }
  try {
    rmdirSync(directory)
  } catch {
    // Something else is in the folder.
  }
}
