import type { SessionResource } from '@shared/types/session-resource'
import { useQuery } from '@tanstack/react-query'
import { FileImage } from 'lucide-react'
import { cn } from '@/shared/lib/cn'
import { sessionResourceContentQueryOptions } from '../hooks/useSessionResources'

function resourceDataUrl(mimeType: string, dataBase64: string) {
  return `data:${mimeType};base64,${dataBase64}`
}

export function SessionResourcePreview({
  resource,
  sessionId,
  className,
}: {
  readonly resource: SessionResource
  readonly sessionId: string
  readonly className?: string
}) {
  const content = useQuery({
    ...sessionResourceContentQueryOptions(sessionId, resource.id),
    enabled:
      resource.kind === 'image' && resource.locator?.startsWith('session-resource://') === true,
  })
  const source = content.data
    ? resourceDataUrl(content.data.mimeType, content.data.dataBase64)
    : null

  return source ? (
    <img
      alt={resource.title}
      src={source}
      className={cn('size-full object-cover', className)}
      draggable={false}
    />
  ) : (
    <span
      className={cn(
        'flex size-full items-center justify-center bg-bg-tertiary text-text-tertiary',
        className,
      )}
    >
      <FileImage className="size-5" />
    </span>
  )
}
