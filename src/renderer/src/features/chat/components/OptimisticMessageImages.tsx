import type { UIMessage } from '@shared/types/chat-ui'
import { useEffect } from 'react'

function OptimisticImage({ source, name }: { readonly source: string; readonly name: string }) {
  useEffect(
    () => () => {
      if (source.startsWith('blob:')) URL.revokeObjectURL(source)
    },
    [source],
  )

  return <img src={source} alt={name} className="size-full object-cover" />
}

export function OptimisticMessageImages({ message }: { readonly message: UIMessage }) {
  const images = message.parts.filter(
    (part): part is Extract<(typeof message.parts)[number], { type: 'image' }> =>
      part.type === 'image',
  )
  if (images.length === 0) return null

  return (
    <fieldset
      className="session-message-image-grid m-0 grid w-52 max-w-full gap-2 border-0 p-0"
      aria-label="Message images"
    >
      {images.map((image, index) => (
        <div
          key={`${message.id}-image-${String(index)}`}
          className="aspect-[4/3] min-w-0 overflow-hidden rounded-lg border border-border bg-bg-secondary"
        >
          <OptimisticImage
            source={image.source.value}
            name={image.name ?? `Attached image ${String(index + 1)}`}
          />
        </div>
      ))}
    </fieldset>
  )
}
