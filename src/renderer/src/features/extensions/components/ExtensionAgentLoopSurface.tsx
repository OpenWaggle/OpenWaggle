import { matchBy } from '@diegogbrisa/ts-match'
import type { ExtensionContributionRegistryView } from '@shared/types/extensions'
import type { JsonObject } from '@shared/types/json'
import { Bot } from 'lucide-react'
import type { ReactNode } from 'react'
import { PanelErrorBoundary } from '@/shared/ui/PanelErrorBoundary'
import type { ResolvedExtensionAgentLoopContribution } from '../lib/extension-agent-loop-resolution'
import {
  resolveExtensionAgentLoopContribution,
  resolveExtensionAgentLoopContributionEntries,
} from '../lib/extension-agent-loop-resolution'
import type {
  ExtensionAgentLoopSurfaceInput,
  ExtensionCustomMessageView,
  ExtensionInteractionActionView,
  ExtensionInteractionView,
  ExtensionStatusView,
  ExtensionToolResultView,
} from '../lib/extension-agent-loop-surface-model'
import {
  CUSTOM_INTERACTION_RESPONSE_ACTION_ID,
  CUSTOM_INTERACTION_UNAVAILABLE_ACTION_ID,
  surfaceFamily,
  surfaceLabel,
  surfacePayload,
  surfaceTarget,
} from '../lib/extension-agent-loop-surface-model'
import { ExtensionAgentLoopFallback } from './ExtensionAgentLoopFallback'
import { ExtensionContributionRuntimeHost } from './ExtensionContributionRuntimeHost'

export type {
  ExtensionAgentLoopSurfaceInput,
  ExtensionCustomMessageView,
  ExtensionInteractionActionView,
  ExtensionInteractionView,
  ExtensionStatusView,
  ExtensionToolResultView,
}
export { CUSTOM_INTERACTION_RESPONSE_ACTION_ID, CUSTOM_INTERACTION_UNAVAILABLE_ACTION_ID }

const TRANSCRIPT_RENDERER_MAX_HEIGHT = 360
const TOOL_RENDERER_MAX_HEIGHT = 420
const CUSTOM_MESSAGE_RENDERER_MAX_HEIGHT = 360
const INTERACTION_RENDERER_MAX_HEIGHT = 360
const STATUS_RENDERER_MAX_HEIGHT = 160
const AGENT_LOOP_RENDERER_MIN_HEIGHT = 96

function ExtensionAgentLoopChrome({
  title,
  children,
}: {
  readonly title: string
  readonly children: ReactNode
}) {
  return (
    <section className="rounded-xl border border-border bg-[#111418] p-3 text-text-secondary">
      <div className="mb-3 flex min-w-0 items-center gap-2">
        <Bot className="size-4 shrink-0 text-accent" />
        <h3 className="truncate text-[12px] font-semibold text-text-primary">{title}</h3>
      </div>
      {children}
    </section>
  )
}

function agentLoopRendererMaxHeight(input: ExtensionAgentLoopSurfaceInput) {
  return matchBy(input, 'surface')
    .with('transcript', () => TRANSCRIPT_RENDERER_MAX_HEIGHT)
    .with('tool', () => TOOL_RENDERER_MAX_HEIGHT)
    .with('custom-message', () => CUSTOM_MESSAGE_RENDERER_MAX_HEIGHT)
    .with('interaction', () => INTERACTION_RENDERER_MAX_HEIGHT)
    .with('status', () => STATUS_RENDERER_MAX_HEIGHT)
    .exhaustive()
}

function ExtensionRenderer({
  input,
  contribution,
  payload,
}: {
  readonly input: ExtensionAgentLoopSurfaceInput
  readonly contribution: ResolvedExtensionAgentLoopContribution
  readonly payload: JsonObject
}) {
  const entry = contribution.entry
  return (
    <PanelErrorBoundary name={`Extension renderer: ${entry.title}`} className="min-h-0">
      <ExtensionContributionRuntimeHost
        autoHeight
        chrome="bare"
        entry={entry}
        maxAutoHeight={agentLoopRendererMaxHeight(input)}
        minAutoHeight={AGENT_LOOP_RENDERER_MIN_HEIGHT}
        onSurfaceAction={
          input.surface === 'interaction' && input.onAction
            ? (actionId, payload) => input.onAction?.(input.interaction.id, actionId, payload)
            : undefined
        }
        surfacePayload={payload}
      />
    </PanelErrorBoundary>
  )
}

function extensionContributionKey(contribution: ResolvedExtensionAgentLoopContribution) {
  const entry = contribution.entry
  return `${entry.packagePath}:${entry.contentHash}:${entry.contributionId}`
}

function TranscriptRenderers({
  contributions,
  input,
  payload,
}: {
  readonly contributions: readonly ResolvedExtensionAgentLoopContribution[]
  readonly input: ExtensionAgentLoopSurfaceInput
  readonly payload: JsonObject
}) {
  return (
    <section aria-label="Transcript extension renderers" className="grid gap-3">
      {contributions.map((contribution) => (
        <ExtensionAgentLoopChrome
          key={extensionContributionKey(contribution)}
          title={contribution.entry.title}
        >
          <ExtensionRenderer contribution={contribution} input={input} payload={payload} />
        </ExtensionAgentLoopChrome>
      ))}
    </section>
  )
}

export function ExtensionAgentLoopSurface({
  input,
  registry,
  projectPaths,
  fallback,
}: {
  readonly input: ExtensionAgentLoopSurfaceInput
  readonly registry: ExtensionContributionRegistryView | null
  readonly projectPaths: readonly string[]
  readonly fallback?: ReactNode | null
}) {
  const fallbackTitle = surfaceLabel(input)
  const payload = surfacePayload(input)
  const fallbackContent =
    fallback === undefined ? <ExtensionAgentLoopFallback input={input} /> : fallback

  if (registry === null) {
    if (fallback !== undefined) {
      return fallbackContent
    }

    return fallbackContent === null ? null : (
      <ExtensionAgentLoopChrome title={fallbackTitle}>{fallbackContent}</ExtensionAgentLoopChrome>
    )
  }

  const target = surfaceTarget(input)
  const resolution = resolveExtensionAgentLoopContribution({
    registry,
    target,
    requestedProjectPaths: projectPaths,
  })

  if (input.surface === 'transcript') {
    const contributions = resolveExtensionAgentLoopContributionEntries({
      registry,
      target,
      requestedProjectPaths: projectPaths,
      family: surfaceFamily(input),
    })

    if (contributions.length > 0) {
      return <TranscriptRenderers contributions={contributions} input={input} payload={payload} />
    }
  }

  if (resolution.status !== 'available' && fallback !== undefined) {
    return fallbackContent
  }

  const title =
    resolution.status === 'available' ? resolution.contribution.entry.title : fallbackTitle

  return (
    <ExtensionAgentLoopChrome title={title}>
      {resolution.status === 'available' ? (
        <ExtensionRenderer input={input} payload={payload} contribution={resolution.contribution} />
      ) : (
        fallbackContent
      )}
    </ExtensionAgentLoopChrome>
  )
}
