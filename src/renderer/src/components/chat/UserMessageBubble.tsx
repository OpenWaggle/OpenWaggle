import type { UIMessage } from '@tanstack/ai-react'

interface UserMessageBubbleProps {
  message: UIMessage
}

export function UserMessageBubble({ message }: UserMessageBubbleProps): React.JSX.Element {
  return (
    /* User msg container — justifyContent: end, width: fill_container */
    <div className="flex justify-end w-full">
      {/* User bubble — cornerRadius [16,16,2,16], fill #1e2229, padding [10,14], stroke #2a3240 1px */}
      <div className="rounded-[16px_16px_2px_16px] bg-bg-hover border border-border-light py-2.5 px-3.5">
        <div className="text-[14px] leading-[1.5] text-text-primary">
          {message.parts
            .filter(
              (p): p is Extract<(typeof message.parts)[number], { type: 'text' }> =>
                p.type === 'text',
            )
            .map((p, i) => (
              <span key={`${message.id}-text-${String(i)}`}>{p.content}</span>
            ))}
        </div>
      </div>
    </div>
  )
}
