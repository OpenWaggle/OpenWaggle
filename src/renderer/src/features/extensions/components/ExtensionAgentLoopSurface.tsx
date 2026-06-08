import type { ExtensionContributionRegistryView } from '@shared/types/extensions'
import type { JsonObject } from '@shared/types/json'
import { Bot } from 'lucide-react'
import type { ReactNode } from 'react'
import { PanelErrorBoundary } from '@/shared/ui/PanelErrorBoundary'
import type { ExtensionAgentLoopResolution } from '../lib/extension-agent-loop-resolution'
import { resolveExtensionAgentLoopContribution } from '../lib/extension-agent-loop-resolution'
import type {
  ExtensionAgentLoopSurfaceInput,
  ExtensionCustomMessageView,
  ExtensionInteractionActionView,
  ExtensionInteractionView,
  ExtensionStatusView,
  ExtensionToolResultView,
} from '../lib/extension-agent-loop-surface-model'
import {
  surfaceLabel,
  surfacePayload,
  surfaceTarget,
} from '../lib/extension-agent-loop-surface-model'
import { ExtensionAgentLoopFallback } from './ExtensionAgentLoopFallback'
import { ExtensionFederatedModuleHost } from './ExtensionFederatedModuleHost'

export type {
  ExtensionAgentLoopSurfaceInput,
  ExtensionCustomMessageView,
  ExtensionInteractionActionView,
  ExtensionInteractionView,
  ExtensionStatusView,
  ExtensionToolResultView,
}

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
  if (input.surface === 'transcript') {
    return TRANSCRIPT_RENDERER_MAX_HEIGHT
  }

  if (input.surface === 'tool') {
    return TOOL_RENDERER_MAX_HEIGHT
  }

  if (input.surface === 'custom-message') {
    return CUSTOM_MESSAGE_RENDERER_MAX_HEIGHT
  }

  if (input.surface === 'interaction') {
    return INTERACTION_RENDERER_MAX_HEIGHT
  }

  return STATUS_RENDERER_MAX_HEIGHT
}

function ExtensionRenderer({
  input,
  resolution,
  payload,
}: {
  readonly input: ExtensionAgentLoopSurfaceInput
  readonly resolution: Extract<ExtensionAgentLoopResolution, { readonly status: 'available' }>
  readonly payload: JsonObject
}) {
  const entry = resolution.contribution.entry
  return (
    <PanelErrorBoundary name={`Extension renderer: ${entry.title}`} className="min-h-0">
      <ExtensionFederatedModuleHost
        autoHeight
        chrome="bare"
        entry={entry}
        maxAutoHeight={agentLoopRendererMaxHeight(input)}
        minAutoHeight={AGENT_LOOP_RENDERER_MIN_HEIGHT}
        surfacePayload={payload}
      />
    </PanelErrorBoundary>
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

  const resolution = resolveExtensionAgentLoopContribution({
    registry,
    target: surfaceTarget(input),
    requestedProjectPaths: projectPaths,
  })

  if (resolution.status !== 'available' && fallback !== undefined) {
    return fallbackContent
  }

  const title =
    resolution.status === 'available' ? resolution.contribution.entry.title : fallbackTitle

  return (
    <ExtensionAgentLoopChrome title={title}>
      {resolution.status === 'available' ? (
        <ExtensionRenderer input={input} payload={payload} resolution={resolution} />
      ) : (
        fallbackContent
      )}
    </ExtensionAgentLoopChrome>
  )
}
