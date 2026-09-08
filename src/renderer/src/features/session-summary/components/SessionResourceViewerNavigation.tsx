import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from '@/shared/ui/Button'

export function SessionResourceViewerNavigation({
  previousResourceId,
  nextResourceId,
  onNavigate,
}: {
  readonly previousResourceId: string | null
  readonly nextResourceId: string | null
  readonly onNavigate: (resourceId: string) => void
}) {
  return (
    <>
      <Button
        variant="secondary"
        size="icon-sm"
        aria-label="Previous image"
        disabled={previousResourceId === null}
        className="fixed left-5 top-1/2 z-10"
        onClick={() => {
          if (previousResourceId) onNavigate(previousResourceId)
        }}
      >
        <ChevronLeft className="size-5" />
      </Button>
      <Button
        variant="secondary"
        size="icon-sm"
        aria-label="Next image"
        disabled={nextResourceId === null}
        className="fixed right-5 top-1/2 z-10"
        onClick={() => {
          if (nextResourceId) onNavigate(nextResourceId)
        }}
      >
        <ChevronRight className="size-5" />
      </Button>
    </>
  )
}
