import type { AgentSession, SessionEntry } from '@earendil-works/pi-coding-agent'
import type { SessionUsageSummary } from '@shared/types/context-usage'
import { createModelRef } from '@shared/types/llm'
import { isRecord } from '@shared/utils/validation'

interface UsageTotals {
  tokens: number
  cost: number
}

function usageTotals(usage: unknown): UsageTotals | null {
  if (!isRecord(usage)) return null
  const count = (key: string) => {
    const value = usage[key]
    return typeof value === 'number' && Number.isFinite(value) ? value : 0
  }
  const cost = isRecord(usage.cost) && typeof usage.cost.total === 'number' ? usage.cost.total : 0
  return {
    tokens: count('input') + count('output') + count('cacheRead') + count('cacheWrite'),
    cost,
  }
}

/**
 * Who a Session entry's usage belongs to, as Pi's `/session` groups it: the physical model that
 * answered a response (a virtual selection's responses name the model it routed to) or a cache
 * refresh named; `null` for usage no model is named on, such as codemode's `models.*` calls and
 * summaries.
 */
function attributedUsage(entry: SessionEntry) {
  if (entry.type === 'message' && entry.message.role === 'assistant') {
    const { message } = entry
    const model = message.responseModel ?? message.model
    return { model: createModelRef(message.provider, model), usage: message.usage }
  }
  if (entry.type === 'usage') {
    return { model: createModelRef(entry.provider, entry.model), usage: entry.usage }
  }
  if (entry.type === 'message' && entry.message.role === 'toolResult' && entry.message.usage) {
    return { model: null, usage: entry.message.usage }
  }
  if ((entry.type === 'branch_summary' || entry.type === 'compaction') && entry.usage) {
    return { model: null, usage: entry.usage }
  }
  return null
}

/**
 * The Session's token and cost totals, per physical model, the GUI equivalent of Pi's `/session`.
 * Every Session entry counts, including cache-warming refreshes and the model calls codemode
 * scripts make, so the totals match Pi's.
 */
export function summarizePiSessionUsage(session: Pick<AgentSession, 'sessionManager'>) {
  const byModel = new Map<string | null, UsageTotals>()
  for (const entry of session.sessionManager.getEntries()) {
    const attributed = attributedUsage(entry)
    const totals = attributed ? usageTotals(attributed.usage) : null
    if (!attributed || !totals) continue
    const current = byModel.get(attributed.model) ?? { tokens: 0, cost: 0 }
    byModel.set(attributed.model, {
      tokens: current.tokens + totals.tokens,
      cost: current.cost + totals.cost,
    })
  }
  const models = [...byModel]
    .map(([model, totals]) => ({ model, ...totals }))
    .filter((entry) => entry.cost > 0 || entry.tokens > 0)
    .sort((left, right) => right.cost - left.cost)
  return {
    tokens: models.reduce((sum, entry) => sum + entry.tokens, 0),
    cost: models.reduce((sum, entry) => sum + entry.cost, 0),
    models,
  } satisfies SessionUsageSummary
}
