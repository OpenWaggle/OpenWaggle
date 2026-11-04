import { THINKING_LEVEL_LABELS } from '@shared/constants/thinking-level-labels'
import type { HiveSession } from '@/queries/session-hive-contract'

/** A model reference without its provider: `spark/GLM-5.3-Flash` reads `GLM-5.3-Flash`. */
function shortModelName(modelId: string) {
  return modelId.slice(modelId.lastIndexOf('/') + 1) || modelId
}

/**
 * The Agent definition a Session was created from, with the thinking level set for it and the
 * model it runs with: the row's identity line ("reviewer · High · GLM-5.3-Flash"). The level is
 * named as the composer names it; "Off" beside a definition would read as the definition being
 * off, so the line says "No thinking". Null for a Session created without one.
 */
export function hiveAgentPresentation(session: HiveSession) {
  const lineage = session.lineage
  const name = lineage?.agentDefinitionName
  if (!name) return null
  const modelId = lineage.agentModelId ?? null
  const level = lineage.agentThinkingLevel ?? null
  return {
    name,
    thinking: level ? THINKING_LEVEL_LABELS[level] : null,
    thinkingLine:
      level === null ? null : level === 'off' ? 'No thinking' : THINKING_LEVEL_LABELS[level],
    modelId,
    model: modelId ? shortModelName(modelId) : null,
  }
}

export type HiveAgentPresentation = NonNullable<ReturnType<typeof hiveAgentPresentation>>

/** "agent reviewer, thinking High, model spark/GLM-5.3-Flash": the identity line, read aloud. */
export function agentAccessibleName(agent: HiveAgentPresentation) {
  return [
    `agent ${agent.name}`,
    ...(agent.thinking ? [`thinking ${agent.thinking}`] : []),
    ...(agent.modelId ? [`model ${agent.modelId}`] : []),
  ].join(', ')
}

/** The identity line's tooltip: "Agent definition: reviewer · thinking High · model spark/GLM". */
export function agentIdentityTitle(agent: HiveAgentPresentation) {
  return [
    `Agent definition: ${agent.name}`,
    ...(agent.thinking ? [`thinking ${agent.thinking}`] : []),
    ...(agent.modelId ? [`model ${agent.modelId}`] : []),
  ].join(' · ')
}
