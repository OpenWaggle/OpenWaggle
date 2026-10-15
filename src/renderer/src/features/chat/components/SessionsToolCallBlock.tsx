import { useNavigate } from '@tanstack/react-router'
import { SquareArrowOutUpRight } from 'lucide-react'
import {
  findHiveSession,
  sessionsToolTarget,
  sessionsToolTargetId,
} from '@/features/chat/lib/sessions-tool-target'
import { parseToolArgs } from '@/features/chat/lib/tool-args'
import type { ToolCallResultPayload } from '@/features/chat/lib/tool-call-block'
import { useHiveSessionState } from '@/features/hive-panel'
import type { HiveSession } from '@/queries/session-hive-contract'
import { cn } from '@/shared/lib/cn'
import { Button } from '@/shared/ui/Button'
import { useToolRowSessionId } from '../hooks/ToolRowSessionContext'
import { useSessionsToolHive } from '../hooks/useSessionsToolHive'
import { ToolCallBlock } from './ToolCallBlock'

interface SessionsToolCallBlockProps {
  readonly name: string
  readonly args: string
  readonly state: string
  readonly result?: ToolCallResultPayload
  readonly isStreaming?: boolean
  readonly onBranchFromMessage?: (messageId: string) => void
  readonly resultNotRecorded?: boolean
}

/**
 * A sessions-tool row names the Session it acts on as the Hive panel does (its current title and
 * Agent definition). A spawn row also carries the Worker's live state and opens it. A spawn made
 * inside a script has no recorded result, so its row keeps the requested name without them.
 */
export function SessionsToolCallBlock(props: SessionsToolCallBlockProps) {
  const hive = useSessionsToolHive()
  const callerSessionId = useToolRowSessionId()
  const parsedArgs = parseToolArgs(props.args)
  const targetId = sessionsToolTargetId(
    parsedArgs,
    props.result?.content,
    callerSessionId === null ? null : String(callerSessionId),
  )
  const session = findHiveSession(targetId, hive)
  const spawned = parsedArgs.action === 'spawn' && session !== null ? session : null
  return (
    <ToolCallBlock
      {...props}
      hive={{
        target: sessionsToolTarget(session),
        headerAddon: spawned ? <WorkerSpawnControls session={spawned} /> : null,
      }}
    />
  )
}

function WorkerSpawnControls({ session }: { readonly session: HiveSession }) {
  const { state } = useHiveSessionState(session)
  const navigate = useNavigate()
  return (
    <>
      <span
        className={cn(
          'shrink-0 text-xs',
          state.needsAttention ? 'text-warning' : 'text-text-tertiary',
        )}
        title={state.hint}
      >
        {/* The long form: the panel's short State cell leans on its group heading. */}
        {state.label}
      </span>
      <Button
        variant="ghost"
        size="xs"
        leftIcon={<SquareArrowOutUpRight aria-hidden="true" className="size-3" />}
        aria-label={`Open ${session.title}`}
        onClick={() => {
          void navigate({ to: '/sessions/$sessionId', params: { sessionId: String(session.id) } })
        }}
      >
        Open
      </Button>
    </>
  )
}
