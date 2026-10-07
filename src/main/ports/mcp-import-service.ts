import type { McpConfigFileScope } from '@shared/types/mcp-configuration'
import type {
  McpImportApplyRequest,
  McpImportApplyResultView,
  McpImportPreviewRequest,
  McpImportPreviewView,
} from '@shared/types/mcp-configuration-operations'
import { Context, type Effect } from 'effect'
import type { McpConfigurationError } from './mcp-configuration-service'

export interface McpImportWriteEntry {
  readonly name: string
  readonly entry: Readonly<Record<string, unknown>>
  /** True when the entry is written over a configured server of that exact name. */
  readonly replace: boolean
}

/** Saves imported entries to OpenWaggle's file for `target`, one server at a time. */
export type McpImportEntryWriter = (
  target: McpConfigFileScope,
  writes: readonly McpImportWriteEntry[],
) => Effect.Effect<void, McpConfigurationError>

/**
 * Import from tools whose MCP files Pi and OpenWaggle do not read live (Codex, Claude Desktop
 * and Code, Cursor, VS Code, OpenCode, Zed, Windsurf). The importer reads their files and hands
 * Pi entries to the caller's writer; it never writes a file itself.
 */
export interface McpImportServiceShape {
  readonly preview: (
    input: McpImportPreviewRequest,
  ) => Effect.Effect<McpImportPreviewView, McpConfigurationError>
  readonly apply: (
    input: McpImportApplyRequest,
    write: McpImportEntryWriter,
  ) => Effect.Effect<Omit<McpImportApplyResultView, 'view'>, McpConfigurationError>
}

export class McpImportService extends Context.Tag('@openwaggle/McpImportService')<
  McpImportService,
  McpImportServiceShape
>() {}
