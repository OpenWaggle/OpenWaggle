export const TRUSTABLE_TOOL_NAMES = ['writeFile', 'editFile', 'runCommand', 'webFetch'] as const

export type TrustableToolName = (typeof TRUSTABLE_TOOL_NAMES)[number]

export function isTrustableToolName(value: string): value is TrustableToolName {
  for (const toolName of TRUSTABLE_TOOL_NAMES) {
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
  readonly tools?: Readonly<Partial<Record<TrustableToolName, ToolApprovalTrustEntry>>>
}
