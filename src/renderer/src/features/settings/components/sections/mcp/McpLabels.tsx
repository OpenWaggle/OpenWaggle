import { match } from '@diegogbrisa/ts-match'
import type { McpServerFileReference } from '@shared/types/mcp-configuration'
import { cn } from '@/shared/lib/cn'
import { tildifyPath } from '@/shared/lib/tildify-path'
import {
  MCP_FILE_LABELS,
  MCP_STATUS_COPY,
  type McpServerStatus,
} from '../../../lib/mcp-server-model'

export function McpStatusPill({ status }: { readonly status: McpServerStatus }) {
  const copy = MCP_STATUS_COPY[status]
  const toneClassName = match(copy.tone)
    .with('good', () => 'bg-success/10 text-success')
    .with('warning', () => 'bg-warning/10 text-warning')
    .with('error', () => 'bg-error/10 text-error-text')
    .with('neutral', () => 'bg-bg-tertiary text-text-tertiary')
    .exhaustive()
  return (
    <span className={cn('rounded px-1.5 py-0.5 text-xs font-medium', toneClassName)}>
      {copy.label}
    </span>
  )
}

/** A file in plain words, with its path beside it. */
export function McpFileLabel({ file }: { readonly file: McpServerFileReference }) {
  return (
    <span className="min-w-0 truncate" title={file.path}>
      {MCP_FILE_LABELS[file.fileId]}
      <span className="ml-1.5 font-mono text-text-muted">{tildifyPath(file.path)}</span>
    </span>
  )
}

export function McpInlineError({ message }: { readonly message: string | null }) {
  if (!message) return null
  return (
    <p role="alert" className="text-xs leading-5 text-error-text">
      {message}
    </p>
  )
}
