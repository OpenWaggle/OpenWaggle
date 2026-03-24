import type { ApprovalRequiredToolName } from '../../main/tools/built-in-tools'

export type { ApprovalRequiredToolName }

/**
 * Runtime list of tool names that require approval. Used by the renderer
 * for trust checks and the approval banner.
 *
 * Must match the tools in `approvalRequiredTools` from `built-in-tools.ts`.
 * The main process validates this at startup via `assertApprovalToolNamesMatch`.
 */
export const APPROVAL_REQUIRED_TOOL_NAMES: readonly ApprovalRequiredToolName[] = [
  'writeFile',
  'editFile',
  'runCommand',
  'webFetch',
]

export function isApprovalRequiredToolName(value: string): value is ApprovalRequiredToolName {
  for (const toolName of APPROVAL_REQUIRED_TOOL_NAMES) {
    if (toolName === value) {
      return true
    }
  }
  return false
}

export interface ToolApprovalPatternRule {
  readonly pattern: string
  readonly timestamp?: string
  readonly source?: string
}

export interface ToolApprovalTrustEntry {
  readonly trusted?: boolean
  readonly timestamp?: string
  readonly source?: string
  readonly allowPatterns?: readonly ToolApprovalPatternRule[]
}

export interface ToolApprovalConfig {
  readonly tools?: Readonly<Partial<Record<ApprovalRequiredToolName, ToolApprovalTrustEntry>>>
}
