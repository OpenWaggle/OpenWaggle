import type { T3ProjectActionsDiscovery } from '@shared/types/project-actions'
import { Download } from 'lucide-react'
import { Button } from '@/shared/ui/Button'
import { ProjectActionGlyph } from './ProjectActionGlyph'

interface T3ProjectActionImportsProps {
  readonly discovery: T3ProjectActionsDiscovery | undefined
  readonly saving: boolean
  readonly onImport: (sourceIndex: number) => void
}

export function T3ProjectActionImports(props: T3ProjectActionImportsProps) {
  if (props.discovery === undefined) {
    return <p className="text-xs text-text-tertiary">Checking t3.json…</p>
  }
  if (props.discovery.status === 'invalid') {
    return (
      <div role="alert" className="rounded-lg border border-warning/30 bg-warning/5 px-3 py-2">
        <div className="text-xs font-medium text-warning">t3.json is invalid</div>
        <div className="mt-0.5 text-xs text-text-tertiary">{props.discovery.error}</div>
      </div>
    )
  }
  if (props.discovery.status === 'missing') {
    return (
      <p className="text-xs text-text-muted">
        No t3.json found. Add an OpenWaggle action below whenever you need one.
      </p>
    )
  }
  if (props.discovery.candidates.length === 0) {
    return <p className="text-xs text-text-muted">No unimported t3.json actions.</p>
  }
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-bg">
      {props.discovery.candidates.map((candidate) => (
        <div
          key={candidate.sourceIndex}
          className="flex min-h-14 items-center gap-3 border-t border-border px-3 first:border-t-0"
        >
          <ProjectActionGlyph icon={candidate.icon} className="size-4 text-text-tertiary" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-xs font-medium text-text-primary">{candidate.name}</div>
            <code className="block truncate text-xs text-text-tertiary">{candidate.command}</code>
          </div>
          <Button
            variant="ghost"
            size="xs"
            disabled={props.saving}
            onClick={() => props.onImport(candidate.sourceIndex)}
            aria-label={`Import ${candidate.name}`}
          >
            <Download className="size-3" />
            Import
          </Button>
        </div>
      ))}
    </div>
  )
}
