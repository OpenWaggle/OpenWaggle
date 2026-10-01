const CONTENT_TRUNCATED = '\n[Content truncated]\n'
/** The kept budget is split between the start and the end of the message. */
const KEPT_PARTS = 2

/**
 * Keeps the start of a request and its final constraints when it is too long. Ported from T3 Code
 * (MIT License, Copyright (c) 2026 T3 Tools Inc.) per ADR 0043.
 */
export function limitTitleMessage(text: string, budget: number) {
  if (text.length <= budget) return text
  if (budget <= CONTENT_TRUNCATED.length) return ''
  const available = budget - CONTENT_TRUNCATED.length
  const head = Math.ceil(available / KEPT_PARTS)
  const tail = available - head
  return `${text.slice(0, head)}${CONTENT_TRUNCATED}${tail > 0 ? text.slice(-tail) : ''}`
}
