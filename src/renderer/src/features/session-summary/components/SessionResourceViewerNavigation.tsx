import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from '@/shared/ui/Button'

export function SessionResourceViewerNavigation({
  previousResourceId,
  nextResourceId,
  onPrevious,
  onNext,
}: {
  readonly previousResourceId: string | null
  readonly nextResourceId: string | null
  readonly onPrevious: () => void
  readonly onNext: () => void
}) {
  return (
    <>
      <Button
        variant="secondary"
        size="icon-sm"
        aria-label="Previous image"
        disabled={previousResourceId === null}
        className="fixed left-5 top-1/2 z-10"
        onClick={onPrevious}
      >
        <ChevronLeft className="size-5" />
      </Button>
      <Button
        variant="secondary"
        size="icon-sm"
        aria-label="Next image"
        disabled={nextResourceId === null}
        className="fixed right-5 top-1/2 z-10"
        onClick={onNext}
      >
        <ChevronRight className="size-5" />
      </Button>
    </>
  )
}
