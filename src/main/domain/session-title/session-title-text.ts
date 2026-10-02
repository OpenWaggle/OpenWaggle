const CONTENT_TRUNCATED = '\n[Content truncated]\n'
/** The kept budget is split between the start and the end of the message. */
const KEPT_PARTS = 2

/**
 * Keeps the start of a request and its final constraints when it is too long. Ported from T3 Code
 * (MIT License, Copyright (c) 2026 T3 Tools Inc., reproduced in THIRD_PARTY_NOTICES.md) per ADR
 * 0043.
 */
export function limitTitleMessage(text: string, budget: number) {
  if (text.length <= budget) return text
  if (budget <= CONTENT_TRUNCATED.length) return ''
  const available = budget - CONTENT_TRUNCATED.length
  const head = Math.ceil(available / KEPT_PARTS)
  const tail = available - head
  return `${text.slice(0, head)}${CONTENT_TRUNCATED}${tail > 0 ? text.slice(-tail) : ''}`
}

/**
 * Controls, bidi marks and overrides, and line separators would reach the sidebar, header, and
 * window title. A generated title and a Worker's objective, which its Provisional title is cut
 * from, can both come from another model, so neither is trusted.
 */
export const UNSAFE_TITLE_CHARACTERS =
  /[\p{Cc}\u061c\u200e\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069]/gu
