import { match } from '@diegogbrisa/ts-match'
import type { ExtensionDiagnosticView } from '@shared/types/extensions'
import { cn } from '@/shared/lib/cn'
import { formatDisplayPathsInText } from '@/shared/lib/display-path'

const MAX_VISIBLE_DIAGNOSTICS = 3

function diagnosticTone(diagnostic: ExtensionDiagnosticView) {
  return match(diagnostic.severity)
    .with('error', () => 'text-error-text')
    .with('warning', () => 'text-warning')
    .exhaustive()
}

export function ExtensionDiagnostics({
  diagnostics,
  displayRoots = [],
}: {
  readonly diagnostics: readonly ExtensionDiagnosticView[]
  readonly displayRoots?: readonly string[]
}) {
  if (diagnostics.length === 0) {
    return null
  }

  return (
    <div className="mt-3 space-y-1 rounded-md border border-error/20 bg-error/5 p-2">
      {diagnostics.slice(0, MAX_VISIBLE_DIAGNOSTICS).map((diagnostic) => (
        <div key={`${diagnostic.code}:${diagnostic.message}`} className="text-xs">
          <span className={cn('font-medium', diagnosticTone(diagnostic))}>{diagnostic.code}</span>
          <span className="text-text-tertiary">
            : {formatDisplayPathsInText(diagnostic.message, displayRoots)}
          </span>
        </div>
      ))}
      {diagnostics.length > MAX_VISIBLE_DIAGNOSTICS ? (
        <div className="text-xs text-text-muted">
          {diagnostics.length - MAX_VISIBLE_DIAGNOSTICS} more diagnostics
        </div>
      ) : null}
    </div>
  )
}
