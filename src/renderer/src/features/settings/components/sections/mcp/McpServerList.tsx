import { ChevronRight } from 'lucide-react'
import { Button } from '@/shared/ui/Button'
import {
  MCP_EXPOSURE_COPY,
  type McpServerRow,
  mcpToolCountLabel,
} from '../../../lib/mcp-server-model'
import { McpFileLabel, McpStatusPill } from './McpLabels'

function McpServerListRow({
  row,
  onOpen,
}: {
  readonly row: McpServerRow
  readonly onOpen: (name: string) => void
}) {
  const { server } = row
  const toolCount = mcpToolCountLabel(row)
  // The row is named by what it shows, so a screen reader hears the state and file too. The
  // spaces between pieces are for that name; flex layout does not render them.
  return (
    <li className="border-b border-border last:border-b-0">
      <Button
        variant="row"
        align="between"
        className="gap-4 px-4 py-3"
        onClick={() => onOpen(server.name)}
      >
        <span className="min-w-0 space-y-1">
          <span className="flex flex-wrap items-center gap-1.5">
            <span className="text-sm font-medium text-text-primary">
              <span className="sr-only">Open</span> {server.name}
            </span>{' '}
            <McpStatusPill status={row.status} />{' '}
            {toolCount ? (
              <>
                <span className="text-xs text-text-tertiary">{toolCount}</span>{' '}
              </>
            ) : null}
            <span className="text-xs text-text-tertiary">
              <span aria-hidden="true">· </span>
              {MCP_EXPOSURE_COPY[server.exposure].label}
            </span>
          </span>{' '}
          <span className="flex text-xs text-text-tertiary">
            <McpFileLabel file={server.source} />
          </span>
        </span>
        <ChevronRight className="size-4 shrink-0 text-text-muted" />
      </Button>
    </li>
  )
}

export function McpServerList({
  rows,
  onOpen,
}: {
  readonly rows: readonly McpServerRow[]
  readonly onOpen: (name: string) => void
}) {
  if (rows.length === 0) {
    return (
      <p className="rounded-lg border border-border bg-bg px-4 py-6 text-xs text-text-muted">
        No MCP servers yet. Add one, install a recommended server, or import from another app.
      </p>
    )
  }
  return (
    <ul aria-label="MCP servers" className="overflow-hidden rounded-lg border border-border bg-bg">
      {rows.map((row) => (
        <McpServerListRow key={row.server.name} row={row} onOpen={onOpen} />
      ))}
    </ul>
  )
}
