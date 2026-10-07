import type { ChatNestedToolCall } from '@shared/types/chat-ui'
import type { ReactNode } from 'react'
import { nestedToolCallCard } from '@/features/chat/lib/nested-tool-call-view'
import { ToolCallBlock } from './ToolCallBlock'

interface NestedToolCallListProps {
  readonly parentName: string
  readonly calls: readonly ChatNestedToolCall[]
  readonly isStreaming: boolean
}

/** The calls a tool made through Pi `ctx.executeTool()`, rendered under the calling tool's card. */
export function NestedToolCallList({ parentName, calls, isStreaming }: NestedToolCallListProps) {
  return (
    <ul
      aria-label={`Tool calls made by ${parentName}`}
      className="ml-5 mt-1 space-y-1 border-l border-border pl-3"
    >
      {calls.map((call) => {
        const card = nestedToolCallCard(call)
        return (
          <li key={call.id}>
            <ToolCallBlock
              name={card.name}
              args={card.args}
              state={card.state}
              result={card.result}
              isStreaming={isStreaming}
            />
          </li>
        )
      })}
    </ul>
  )
}

interface WithNestedToolCallsProps extends NestedToolCallListProps {
  readonly children: ReactNode
}

/** A tool card followed by the nested calls it made, when it made any. */
export function WithNestedToolCalls({
  parentName,
  calls,
  isStreaming,
  children,
}: WithNestedToolCallsProps) {
  if (calls.length === 0) return children
  return (
    <div>
      {children}
      <NestedToolCallList parentName={parentName} calls={calls} isStreaming={isStreaming} />
    </div>
  )
}
