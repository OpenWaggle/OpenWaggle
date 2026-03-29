import type { ExecutionMode } from '@shared/types/settings'
import {
  APPROVAL_REQUIRED_TOOL_NAMES,
  type ApprovalRequiredToolName,
} from '@shared/types/tool-approval'
import type { ProjectConfig } from '../config/project-config'
import { isToolCallTrusted } from '../config/project-config'
import type { DomainServerTool } from '../ports/tool-types'
import { editFileTool } from '../tools/tools/edit-file'
import { globTool } from '../tools/tools/glob'
import { listFilesTool } from '../tools/tools/list-files'
import { readFileTool } from '../tools/tools/read-file'
import { runCommandTool } from '../tools/tools/run-command'
import { webFetchTool } from '../tools/tools/web-fetch'
import { writeFileTool } from '../tools/tools/write-file'
import { withoutApproval } from '../tools/without-approval'

const EXECUTOR_TOOLSET: readonly DomainServerTool[] = [
  readFileTool,
  globTool,
  listFilesTool,
  writeFileTool,
  editFileTool,
  runCommandTool,
  webFetchTool,
]

const DEFAULT_PERMISSIONS_BLOCK_MESSAGE: Readonly<Record<ApprovalRequiredToolName, string>> = {
  writeFile:
    'Default permissions blocked writeFile in orchestration. Approve a writeFile call in chat first to trust this tool.',
  editFile:
    'Default permissions blocked editFile in orchestration. Approve an editFile call in chat first to trust this tool.',
  runCommand:
    'Default permissions blocked runCommand in orchestration. Approve a matching command in chat to trust this command pattern.',
  webFetch:
    'Default permissions blocked webFetch in orchestration. Approve a matching URL in chat to trust this URL pattern.',
}

function toJsonArgs(args: unknown): string {
  try {
    return JSON.stringify(args)
  } catch {
    return ''
  }
}

function isApprovalRequiredExecutorToolName(name: string): name is ApprovalRequiredToolName {
  for (const toolName of APPROVAL_REQUIRED_TOOL_NAMES) {
    if (toolName === name) {
      return true
    }
  }
  return false
}

interface ExecutableDomainServerTool extends DomainServerTool {
  execute: (args: unknown) => Promise<unknown> | unknown
}

function hasExecutableFunction(tool: DomainServerTool): tool is ExecutableDomainServerTool {
  return 'execute' in tool && typeof tool.execute === 'function'
}

function maybeGetExecutorFunction(
  tool: DomainServerTool,
): ((args: unknown) => Promise<unknown>) | null {
  if (!hasExecutableFunction(tool)) {
    return null
  }

  return async (args: unknown): Promise<unknown> => tool.execute(args)
}

function withDefaultPermissionsTrust(
  tool: DomainServerTool,
  toolName: ApprovalRequiredToolName,
  projectConfig: ProjectConfig,
): DomainServerTool {
  const execute = maybeGetExecutorFunction(tool)
  if (!execute) {
    return { ...tool, needsApproval: false }
  }

  return {
    ...tool,
    needsApproval: false,
    async execute(args: unknown): Promise<unknown> {
      const trusted = isToolCallTrusted(projectConfig, toolName, toJsonArgs(args))
      if (!trusted) {
        return {
          kind: 'json',
          data: {
            ok: false,
            error: DEFAULT_PERMISSIONS_BLOCK_MESSAGE[toolName],
          },
        }
      }

      return execute(args)
    },
  }
}

export function buildExecutorTools(
  executionMode: ExecutionMode,
  projectConfig: ProjectConfig,
): DomainServerTool[] {
  if (executionMode === 'full-access') {
    return withoutApproval(EXECUTOR_TOOLSET)
  }

  return EXECUTOR_TOOLSET.map((tool) => {
    const name = tool.name ?? ''
    if (!isApprovalRequiredExecutorToolName(name)) {
      return tool
    }
    return withDefaultPermissionsTrust(tool, name, projectConfig)
  })
}
