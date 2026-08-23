import {
  AGENT_AUTHORIZATION_CAPABILITY_LABELS,
  type AgentAuthorizationScopeKey,
} from '@shared/types/agent-authorization-grants'
import type {
  AgentLoopConfirmInteraction,
  AgentLoopInteraction,
} from '@shared/types/agent-loop-interaction'

export type PromptInteraction = Extract<
  AgentLoopInteraction,
  { readonly kind: 'confirm' | 'select' | 'input' | 'editor' }
>

export function isPromptInteraction(
  interaction: AgentLoopInteraction,
): interaction is PromptInteraction {
  return (
    interaction.kind === 'confirm' ||
    interaction.kind === 'select' ||
    interaction.kind === 'input' ||
    interaction.kind === 'editor'
  )
}

/** An authorization request, the only kind that carries a grant key and scope choices. */
export function isAuthorizationRequest(
  interaction: AgentLoopInteraction,
): interaction is AgentLoopConfirmInteraction & {
  readonly scopeKey: AgentAuthorizationScopeKey
} {
  return (
    interaction.kind === 'confirm' &&
    interaction.purpose === 'authorization' &&
    interaction.scopeKey !== undefined
  )
}

/**
 * The target line under the question: what is being reached, and to do what.
 *
 * Built from the declared grant key rather than parsed out of the message, so it names exactly what
 * a kept approval would cover.
 */
export function ribbonTargetLine(scopeKey: AgentAuthorizationScopeKey): string {
  const capability = AGENT_AUTHORIZATION_CAPABILITY_LABELS[scopeKey.capability]
  return [scopeKey.resource ?? scopeKey.requester, capability].join(' · ')
}

/**
 * How many requests are waiting behind the one on screen.
 *
 * Counts every pending request, not only the ones this component renders. The counter previously
 * excluded custom interactions even though they occupy the same composer area, so it understated
 * how much was actually blocking the run.
 */
export function queuedRequestCount(interactions: readonly AgentLoopInteraction[]): number {
  const blocking = interactions.filter((interaction) => interaction.kind !== 'notify')
  return Math.max(0, blocking.length - 1)
}

/** The scope choices offered behind `Allow…`, narrowest first. */
export interface AllowScopeChoice {
  readonly scope: 'session' | 'project'
  readonly label: string
}

export function allowScopeChoices(
  scopeKey: AgentAuthorizationScopeKey,
  projectName: string | null,
): readonly AllowScopeChoice[] {
  const target = scopeKey.resource ?? scopeKey.requester
  return [
    { scope: 'session', label: 'Allow for this session' },
    {
      scope: 'project',
      // Names the exact requester, capability and destination, so a standing approval can never be
      // given without seeing what it covers.
      label: projectName
        ? `Always allow ${target} for ${scopeKey.requester} in ${projectName}`
        : `Always allow ${target} for ${scopeKey.requester} in this project`,
    },
  ]
}
