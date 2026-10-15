import type { ReactNode } from 'react'
import {
  type NestedToolCallsView,
  nestedToolCallCard,
} from '@/features/chat/lib/nested-tool-call-view'
import { parseToolArgs } from '@/features/chat/lib/tool-args'
import {
  isHiddenSessionsToolCall,
  SESSIONS_TOOL_NAME,
} from '@/features/chat/lib/tool-labels-sessions'
import { SessionsToolCallBlock } from './SessionsToolCallBlock'
import { ToolCallBlock } from './ToolCallBlock'

interface NestedToolCallListProps {
  readonly parentName: string
  readonly nestedCalls: NestedToolCallsView
  readonly isStreaming: boolean
}

const NOTE_CLASS = 'ml-5 text-xs text-text-muted'

/** The calls a tool made through Pi `ctx.executeTool()`, rendered under the calling tool's card. */
export function NestedToolCallList({
  parentName,
  nestedCalls,
  isStreaming,
}: NestedToolCallListProps) {
  return (
    <div className="ml-5 mt-1 border-l border-border pl-3">
      <ul aria-label={`Tool calls made by ${parentName}`} className="space-y-1">
        {nestedCalls.calls.map((call) => {
          const card = nestedToolCallCard(call)
          if (isHiddenSessionsToolCall(card.name, parseToolArgs(card.args))) return null
          const Block = card.name === SESSIONS_TOOL_NAME ? SessionsToolCallBlock : ToolCallBlock
          return (
            <li key={call.id}>
              <Block
                name={card.name}
                args={card.args}
                state={card.state}
                result={card.result}
                isStreaming={isStreaming}
                resultNotRecorded={card.state === 'complete'}
              />
              {call.argumentsOmitted && <p className={NOTE_CLASS}>Arguments not recorded</p>}
            </li>
          )
        })}
      </ul>
      {nestedCalls.omittedCalls !== null && (
        <p className="mt-1 text-xs text-text-muted">{nestedCalls.omittedCalls}</p>
      )}
    </div>
  )
}

interface WithNestedToolCallsProps extends NestedToolCallListProps {
  readonly children: ReactNode
}

/** A tool card followed by the nested calls it made, when it made any. */
export function WithNestedToolCalls({
  parentName,
  nestedCalls,
  isStreaming,
  children,
}: WithNestedToolCallsProps) {
  if (nestedCalls.calls.length === 0 && nestedCalls.omittedCalls === null) return children
  return (
    <div>
      {children}
      <NestedToolCallList
        parentName={parentName}
        nestedCalls={nestedCalls}
        isStreaming={isStreaming}
      />
    </div>
  )
}
