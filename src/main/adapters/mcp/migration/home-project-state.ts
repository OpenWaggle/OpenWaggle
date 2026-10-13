import type { Logger } from '@shared/types/logger'
import { isRecord } from '@shared/utils/validation'
import { computeProjectFile, type McpFileSources } from './file-computation'
import type { LegacyStateFile } from './legacy-state'

/**
 * A project at the home folder has `~/.openwaggle/mcp.json` as its project file, so the on/off
 * choices the old OpenWaggle kept for that project alone have nowhere of their own to go: writing
 * them to the global file would change every other project too. They are left out and logged, so
 * the user can switch those servers again in that project. True when it logged.
 */
export async function reportHomeFolderProjectState(input: {
  readonly sources: McpFileSources
  readonly state: LegacyStateFile
  readonly projectPath: string
  readonly preserveEnablement: boolean
  readonly logger: Logger
}) {
  if (!input.preserveEnablement) return false
  const computed = await computeProjectFile({
    sources: input.sources,
    state: input.state,
    projectPath: input.projectPath,
    original: undefined,
    preserveEnablement: true,
  })
  const parsed: unknown = computed.text === undefined ? undefined : JSON.parse(computed.text)
  const servers =
    isRecord(parsed) && isRecord(parsed.mcpServers) ? Object.keys(parsed.mcpServers) : []
  if (servers.length === 0) return false
  input.logger.warn(
    'MCP migration left out the on/off choices of the project at the home folder, which shares its file with every project',
    { projectPath: input.projectPath, servers },
  )
  return true
}
