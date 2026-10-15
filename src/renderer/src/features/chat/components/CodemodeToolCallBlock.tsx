import { ChevronRight } from 'lucide-react'
import { useState } from 'react'
import {
  type CodemodeCallView,
  type CodemodeToolView,
  codemodeToolView,
  isCodemodeModelCall,
} from '@/features/chat/lib/codemode-tool-view'
import { parseToolArgs } from '@/features/chat/lib/tool-args'
import type { ToolCallResultPayload } from '@/features/chat/lib/tool-call-block'
import { toolKind } from '@/features/chat/lib/tool-kind'
import { cn } from '@/shared/lib/cn'
import { formatDuration, formatUsd } from '@/shared/lib/format'
import { Button } from '@/shared/ui/Button'
import { PlainTextBlock } from '@/shared/ui/PlainTextBlock'
import { SyntaxBlock } from '@/shared/ui/SyntaxBlock'
import { CopyButton } from './ToolCallBlockParts'
import {
  ToolRowFailureMark,
  ToolRowIcon,
  type ToolRowStatus,
  toolRowLabelClassName,
} from './ToolRowStatus'

interface CodemodeToolCallBlockProps {
  readonly args: string
  readonly state: string
  readonly result?: ToolCallResultPayload
  readonly isStreaming?: boolean
  /**
   * Whether the script's tool calls are shown as nested tool cards under this card (from Pi's
   * nested call events and record). The card then lists only the script's model calls.
   */
  readonly nestedCallsShown?: boolean
}

type ScriptPhase = 'running' | 'completed' | 'failed' | 'requested'

function scriptPhase(
  view: CodemodeToolView,
  state: string,
  result: ToolCallResultPayload | undefined,
  isStreaming: boolean,
): ScriptPhase {
  const finished = result !== undefined && result.state !== 'partial'
  if (!finished) return isStreaming ? 'running' : 'requested'
  return view.failed || result.state === 'error' || state === 'error' ? 'failed' : 'completed'
}

/** A failed script keeps its text; the row marks the failure, as every tool row does. */
const PHASE_LABELS: Record<ScriptPhase, string> = {
  running: 'Running a script…',
  completed: 'Ran a script',
  failed: 'Ran a script',
  requested: 'Requested a script',
}

const PHASE_STATUS: Record<ScriptPhase, ToolRowStatus> = {
  running: 'running',
  completed: 'done',
  failed: 'failed',
  requested: 'requested',
}

const CALL_STATUS: Record<CodemodeCallView['status'], ToolRowStatus> = {
  running: 'running',
  ok: 'done',
  error: 'failed',
  cancelled: 'failed',
}

function countLabel(count: number, noun: string) {
  return count === 1 ? `1 ${noun}` : `${String(count)} ${noun}s`
}

/** The script's tool calls, with its `models.*` calls counted apart. */
function callCountLabel(calls: readonly CodemodeCallView[]) {
  const modelCalls = calls.filter(isCodemodeModelCall).length
  const toolCalls = calls.length - modelCalls
  return [
    ...(toolCalls > 0 ? [countLabel(toolCalls, 'tool call')] : []),
    ...(modelCalls > 0 ? [countLabel(modelCalls, 'model call')] : []),
  ].join(', ')
}

function ScriptCallRow({ call }: { readonly call: CodemodeCallView }) {
  return (
    <li className="flex min-w-0 flex-col gap-0.5 py-0.5">
      <div className="flex min-w-0 items-center gap-2 text-xs">
        <ToolRowIcon kind={toolKind(call.name)} status={CALL_STATUS[call.status]} size="sm" />
        <span className="shrink-0 font-mono text-text-secondary">{call.name}</span>
        <span className="min-w-0 truncate font-mono text-text-tertiary" title={call.args}>
          {call.args}
        </span>
        {(call.status === 'error' || call.status === 'cancelled') && (
          <ToolRowFailureMark label={call.status === 'cancelled' ? 'Cancelled' : 'Failed'} />
        )}
        {call.cost !== undefined && (
          <span className="shrink-0 text-text-muted">{formatUsd(call.cost)}</span>
        )}
        {call.durationMs !== undefined && (
          <span className="ml-auto shrink-0 text-text-muted">
            {formatDuration(Math.round(call.durationMs))}
          </span>
        )}
      </div>
      {call.error && <div className="ml-5 truncate text-xs text-error/80">{call.error}</div>}
    </li>
  )
}

function ScriptCalls({ calls }: { readonly calls: readonly CodemodeCallView[] }) {
  if (calls.length === 0) return null
  return (
    <ul aria-label="Calls made by the script" className="ml-5 mt-1 border-l border-border pl-3">
      {calls.map((call) => (
        <ScriptCallRow key={call.key} call={call} />
      ))}
    </ul>
  )
}

function ScriptImages({ view }: { readonly view: CodemodeToolView }) {
  if (view.images.length === 0) return null
  return (
    <div className="ml-5 mt-2 flex flex-wrap gap-2">
      {view.images.map((image, index) => (
        <img
          key={image.key}
          src={image.src}
          alt={`Script output ${String(index + 1)}`}
          className="max-h-64 max-w-full rounded-md border border-border object-contain"
        />
      ))}
    </div>
  )
}

function ScriptDetails({ view }: { readonly view: CodemodeToolView }) {
  return (
    <div className="ml-5 mt-1 overflow-hidden rounded-md border border-border bg-bg-secondary/50">
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
        {view.script && <CopyButton label="Copy script" value={view.script} />}
        {view.output && <CopyButton label="Copy output" value={view.output} />}
      </div>
      {view.script !== null && (
        <div className="px-3 py-2">
          <div className="mb-1 text-sm text-text-tertiary">Script</div>
          <SyntaxBlock
            source={view.script}
            language="javascript"
            ariaLabel="Script"
            className="rounded-md text-sm"
          />
        </div>
      )}
      {view.output && (
        <div className="border-t border-border px-3 py-2">
          <div className="mb-1 text-sm text-text-tertiary">Output</div>
          <PlainTextBlock reason="log" ariaLabel="Script output" className="max-h-96">
            {view.output}
          </PlainTextBlock>
        </div>
      )}
    </div>
  )
}

/**
 * The transcript card of Pi's `codemode` tool: the script's child calls and images in view, and
 * its script and output on expand. Child calls come from the live partial result while the script
 * runs and from the persisted result afterwards, so the card looks the same after a reload.
 */
export function CodemodeToolCallBlock({
  args,
  state,
  result,
  isStreaming = false,
  nestedCallsShown = false,
}: CodemodeToolCallBlockProps) {
  const [expanded, setExpanded] = useState(false)
  const view = codemodeToolView(parseToolArgs(args), result?.content)
  const phase = scriptPhase(view, state, result, isStreaming)
  const label = PHASE_LABELS[phase]
  const status = PHASE_STATUS[phase]
  const listedCalls = nestedCallsShown ? view.calls.filter(isCodemodeModelCall) : view.calls

  return (
    <div className="group/tool">
      <Button
        variant="unstyled"
        type="button"
        aria-expanded={expanded}
        aria-label={`${label}${phase === 'failed' ? ', failed' : ''} — ${expanded ? 'collapse' : 'expand'} details`}
        onClick={() => setExpanded(!expanded)}
        className="flex w-full min-w-0 items-center gap-2 py-0.5 text-sm transition-colors"
      >
        <ToolRowIcon kind="script" status={status} />
        <span className={cn('truncate', toolRowLabelClassName(status))}>{label}</span>
        {phase === 'failed' && <ToolRowFailureMark />}
        {view.calls.length > 0 && (
          <span className="shrink-0 text-xs text-text-muted">{callCountLabel(view.calls)}</span>
        )}
        {view.modelCost !== undefined && (
          <span className="shrink-0 text-xs text-text-muted">{formatUsd(view.modelCost)}</span>
        )}
        <ChevronRight
          className={cn(
            'ml-auto size-3 shrink-0 text-text-muted transition-transform',
            'invisible group-hover/tool:visible',
            expanded && 'visible rotate-90',
          )}
        />
      </Button>
      <ScriptCalls calls={listedCalls} />
      {view.error && (
        <div role="alert" className="ml-5 mt-1">
          <PlainTextBlock
            reason="error"
            className="max-h-40 border border-error/20 bg-error/5 text-error"
          >
            {view.error}
          </PlainTextBlock>
        </div>
      )}
      <ScriptImages view={view} />
      {expanded && <ScriptDetails view={view} />}
    </div>
  )
}
