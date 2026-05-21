import type { JsonObject } from '@shared/types/json'
import { hasConcreteToolOutput } from '@shared/utils/tool-result-state'
import { useEffect, useRef, useState } from 'react'
import { parseToolArgs } from '@/features/chat/lib/tool-args'
import {
  buildTailPreview,
  getEditUnifiedDiff,
  getResultError,
  getStringArg,
  getToolResultText,
  INLINE_DIFF_LINE_LIMIT,
  type ToolCallResultPayload,
  type UnifiedDiffData,
} from '@/features/chat/lib/tool-call-block'
import { resolveActionText } from '@/features/chat/lib/tool-display'
import { CollapsedToolPreview, ToolCallHeader } from './ToolCallBlockChrome'
import { CopyButton, ToolArgs, ToolResult, UnifiedDiffView } from './ToolCallBlockParts'

interface ToolCallBlockProps {
  name: string
  args: string
  state: string
  result?: ToolCallResultPayload
  isStreaming?: boolean
  onBranchFromMessage?: (messageId: string) => void
}

interface ToolCallViewModelInput {
  readonly name: string
  readonly args: string
  readonly state: string
  readonly result: ToolCallResultPayload | undefined
  readonly isStreaming: boolean
  readonly expanded: boolean
}

export interface ToolCallViewModel {
  readonly actionText: string
  readonly awaitingResult: boolean
  readonly branchSourceMessageId: string | undefined
  readonly command: string | null
  readonly diff: UnifiedDiffData | null
  readonly failedOutputPreview: string
  readonly hasConcreteResult: boolean
  readonly inlineDiffVisible: boolean
  readonly isError: boolean
  readonly isRunning: boolean
  readonly liveOutputPreview: string
  readonly parsedArgs: JsonObject
  readonly path: string | null
  readonly resultError: string | null
  readonly resultText: string
}

function isToolRunning(
  state: string,
  result: ToolCallResultPayload | undefined,
  isStreaming: boolean,
) {
  return isStreaming && (state === 'input-streaming' || state === 'executing' || !result)
}

function shouldReadResultText(
  result: ToolCallResultPayload | undefined,
  expanded: boolean,
  isRunning: boolean,
  isError: boolean,
) {
  return result !== undefined && (expanded || isRunning || isError)
}

function previewText(enabled: boolean, text: string) {
  return enabled && text.trim() ? buildTailPreview(text) : ''
}

function readableResultText(
  result: ToolCallResultPayload | undefined,
  expanded: boolean,
  isRunning: boolean,
  isError: boolean,
) {
  if (!result || !shouldReadResultText(result, expanded, isRunning, isError)) {
    return ''
  }
  return getToolResultText(result.content)
}

function buildToolCallViewModel({
  name,
  args,
  state,
  result,
  isStreaming,
  expanded,
}: ToolCallViewModelInput): ToolCallViewModel {
  const hasConcreteResult = result ? hasConcreteToolOutput(result.content) : false
  const resultError = getResultError(result)
  const isError = resultError !== null
  const isRunning = isToolRunning(state, result, isStreaming)
  const awaitingResult = (!result || !hasConcreteResult) && !isRunning
  const parsedArgs = parseToolArgs(args)
  const diff = result && !isError ? getEditUnifiedDiff(result.content, name) : null
  const resultText = readableResultText(result, expanded, isRunning, isError)

  return {
    actionText: resolveActionText({ name, args: parsedArgs, awaitingResult, isError, isRunning }),
    awaitingResult,
    branchSourceMessageId: result?.sourceMessageId,
    command: getStringArg(parsedArgs, 'command'),
    diff,
    failedOutputPreview: previewText(!expanded && isError, resultText),
    hasConcreteResult,
    inlineDiffVisible: diff !== null && diff.lines.length <= INLINE_DIFF_LINE_LIMIT,
    isError,
    isRunning,
    parsedArgs,
    path: getStringArg(parsedArgs, 'path'),
    resultError,
    resultText,
    liveOutputPreview: previewText(isRunning, resultText),
  }
}

export function ToolCallBlock({
  name,
  args,
  state,
  result,
  isStreaming = false,
  onBranchFromMessage,
}: ToolCallBlockProps) {
  const [expanded, setExpanded] = useState(false)
  const startTime = useRef<number | null>(null)
  const [duration, setDuration] = useState(0)
  const view = buildToolCallViewModel({ name, args, state, result, isStreaming, expanded })

  useEffect(() => {
    if (view.isRunning && !startTime.current) {
      startTime.current = Date.now()
    }
    if (!view.isRunning && startTime.current) {
      setDuration(Date.now() - startTime.current)
      startTime.current = null
    }
  }, [view.isRunning])

  return (
    <div className="group/tool">
      <ToolCallHeader
        expanded={expanded}
        duration={duration}
        result={result}
        view={view}
        onBranchFromMessage={onBranchFromMessage}
        onToggleExpanded={() => setExpanded(!expanded)}
      />
      <CollapsedToolPreview view={view} expanded={expanded} />
      {expanded && <ExpandedToolDetails name={name} args={args} result={result} view={view} />}
    </div>
  )
}

function ExpandedToolDetails({
  name,
  args,
  result,
  view,
}: {
  readonly name: string
  readonly args: string
  readonly result: ToolCallResultPayload | undefined
  readonly view: ToolCallViewModel
}) {
  return (
    <div className="ml-5 mt-1 rounded-md border border-border bg-bg-secondary/50 overflow-hidden">
      <ExpandedCopyActions args={args} view={view} />
      <ExpandedDiffSection diff={view.diff} />
      <div className="px-3 py-2">
        <div className="text-[13px] text-text-tertiary mb-1">Arguments</div>
        <ToolArgs name={name} args={view.parsedArgs} rawArgs={args} path={view.path} />
      </div>
      <ExpandedResultSection name={name} result={result} view={view} />
      <ExpandedErrorSection name={name} result={result} view={view} />
    </div>
  )
}

function ExpandedCopyActions({
  args,
  view,
}: {
  readonly args: string
  readonly view: ToolCallViewModel
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
      <CopyButton label="Copy args" value={args} />
      {view.path && <CopyButton label="Copy path" value={view.path} />}
      {view.command && <CopyButton label="Copy command" value={view.command} />}
      {view.resultText && <CopyButton label="Copy output" value={view.resultText} />}
    </div>
  )
}

function ExpandedDiffSection({ diff }: { readonly diff: ReturnType<typeof getEditUnifiedDiff> }) {
  if (!diff) {
    return null
  }
  return (
    <div className="px-3 py-2">
      <UnifiedDiffView diff={diff} />
    </div>
  )
}

function ExpandedResultSection({
  name,
  result,
  view,
}: {
  readonly name: string
  readonly result: ToolCallResultPayload | undefined
  readonly view: ToolCallViewModel
}) {
  if (!view.hasConcreteResult || !result || view.diff || view.isError) {
    return null
  }
  return (
    <div className="border-t border-border px-3 py-2">
      <div className="text-[13px] text-text-tertiary mb-1">Result</div>
      <ToolResult content={result.content} isError={view.isError} name={name} path={view.path} />
    </div>
  )
}

function ExpandedErrorSection({
  name,
  result,
  view,
}: {
  readonly name: string
  readonly result: ToolCallResultPayload | undefined
  readonly view: ToolCallViewModel
}) {
  if (!result || !view.isError) {
    return null
  }
  return (
    <div role="alert" className="border-t border-border px-3 py-2">
      <div className="text-[13px] text-text-tertiary mb-1">Error</div>
      <ToolResult
        content={view.resultError ?? result.content}
        isError
        name={name}
        path={view.path}
      />
    </div>
  )
}
