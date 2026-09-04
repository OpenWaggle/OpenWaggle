import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from '@/shared/ui/Button'

export function SessionResourceViewerNavigation({
  index,
  count,
  onNavigate,
}: {
  readonly index: number
  readonly count: number
  readonly onNavigate: (index: number) => void
}) {
  return (
    <>
      <Button
        variant="secondary"
        size="icon-sm"
        aria-label="Previous image"
        disabled={index <= 0}
        className="fixed left-5 top-1/2 z-10"
        onClick={() => onNavigate(index - 1)}
      >
        <ChevronLeft className="size-5" />
      </Button>
      <Button
        variant="secondary"
        size="icon-sm"
        aria-label="Next image"
        disabled={index >= count - 1}
        className="fixed right-5 top-1/2 z-10"
        onClick={() => onNavigate(index + 1)}
      >
        <ChevronRight className="size-5" />
      </Button>
    </>
  )
}
