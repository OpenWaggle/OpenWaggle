import type { UIMessage } from '@shared/types/chat-ui'

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
          <img
            src={image.source.value}
            alt={image.name ?? `Attached image ${String(index + 1)}`}
            className="size-full object-cover"
          />
        </div>
      ))}
    </fieldset>
  )
}
