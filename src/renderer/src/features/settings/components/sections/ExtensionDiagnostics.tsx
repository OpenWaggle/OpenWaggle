import { match } from '@diegogbrisa/ts-match'
import type { ExtensionDiagnosticView } from '@shared/types/extensions'
import { cn } from '@/shared/lib/cn'

const MAX_VISIBLE_DIAGNOSTICS = 3

function diagnosticTone(diagnostic: ExtensionDiagnosticView) {
  return match(diagnostic.severity)
    .with('error', () => 'text-error')
    .with('warning', () => 'text-amber-300')
    .exhaustive()
}

export function ExtensionDiagnostics({
  diagnostics,
}: {
  readonly diagnostics: readonly ExtensionDiagnosticView[]
}) {
  if (diagnostics.length === 0) {
    return null
  }

  return (
    <div className="mt-3 space-y-1 rounded-md border border-error/20 bg-error/5 p-2">
      {diagnostics.slice(0, MAX_VISIBLE_DIAGNOSTICS).map((diagnostic) => (
        <div key={`${diagnostic.code}:${diagnostic.message}`} className="text-[11px]">
          <span className={cn('font-medium', diagnosticTone(diagnostic))}>{diagnostic.code}</span>
          <span className="text-text-tertiary">: {diagnostic.message}</span>
        </div>
      ))}
      {diagnostics.length > MAX_VISIBLE_DIAGNOSTICS ? (
        <div className="text-[11px] text-text-muted">
          {diagnostics.length - MAX_VISIBLE_DIAGNOSTICS} more diagnostics
        </div>
      ) : null}
    </div>
  )
}
