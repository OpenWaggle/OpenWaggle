import type { SessionResource } from '@shared/types/session-resource'
import { useQuery } from '@tanstack/react-query'
import { FileImage } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { cn } from '@/shared/lib/cn'
import { sessionResourceThumbnailQueryOptions } from '../hooks/useSessionResources'

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
  const rootRef = useRef<HTMLSpanElement>(null)
  const [nearViewport, setNearViewport] = useState(
    () => typeof IntersectionObserver === 'undefined',
  )
  useEffect(() => {
    if (nearViewport || !rootRef.current || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return
        setNearViewport(true)
        observer.disconnect()
      },
      { rootMargin: '300px' },
    )
    observer.observe(rootRef.current)
    return () => observer.disconnect()
  }, [nearViewport])
  const content = useQuery({
    ...sessionResourceThumbnailQueryOptions(sessionId, resource.id, resource.updatedAt),
    enabled:
      nearViewport &&
      resource.available &&
      resource.kind === 'image' &&
      (resource.managed || resource.locator?.startsWith('https://') !== true),
  })
  const source = content.data
    ? resourceDataUrl(content.data.mimeType, content.data.dataBase64)
    : null

  return (
    <span ref={rootRef} className="block size-full">
      {source ? (
        <img
          alt={resource.title}
          src={source}
          className={cn('size-full object-cover', className)}
          draggable={false}
          loading="lazy"
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
      )}
    </span>
  )
}
