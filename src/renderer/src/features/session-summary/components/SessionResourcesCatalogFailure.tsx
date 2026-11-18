import { Button } from '@/shared/ui/Button'

export function SessionResourcesCatalogFailure({ onRetry }: { readonly onRetry: () => void }) {
  return (
    <div className="rounded-md border border-error/30 bg-error/5 px-3 py-2" role="alert">
      <p className="text-sm text-error">Could not load session resources.</p>
      <Button variant="ghost" size="xs" className="mt-1" onClick={onRetry}>
        Retry
      </Button>
    </div>
  )
}
