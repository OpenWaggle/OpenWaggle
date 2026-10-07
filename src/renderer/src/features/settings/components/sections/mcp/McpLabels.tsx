import { match } from '@diegogbrisa/ts-match'
import type { McpConfigFileKind, McpServerFileReference } from '@shared/types/mcp-configuration'
import { cn } from '@/shared/lib/cn'
import { tildifyPath } from '@/shared/lib/tildify-path'
import { MCP_STATUS_COPY, type McpServerStatus } from '../../../lib/mcp-server-model'

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

/**
 * A file in plain words. Pi's files are named as Pi's: OpenWaggle is the GUI for the Pi ecosystem
 * (ADR 0048), so naming Pi for a resource Pi owns is allowed, and the visible-copy guard checks it.
 */
export function McpFileName({ fileId }: { readonly fileId: McpConfigFileKind }) {
  return match(fileId)
    .with('pi-global', () => <>Pi, all projects</>)
    .with('openwaggle-global', () => <>OpenWaggle, all projects</>)
    .with('project-mcp-json', () => <>Project .mcp.json</>)
    .with('project-pi', () => <>Pi, this project</>)
    .with('project-openwaggle', () => <>OpenWaggle, this project</>)
    .exhaustive()
}

/** A file in plain words, with its path beside it. */
export function McpFileLabel({ file }: { readonly file: McpServerFileReference }) {
  return (
    <span className="min-w-0 truncate" title={file.path}>
      <McpFileName fileId={file.fileId} />
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
