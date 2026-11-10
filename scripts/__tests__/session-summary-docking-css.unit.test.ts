import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const GLOBALS_CSS_URL = new URL('../../src/renderer/src/styles/globals.css', import.meta.url)

/*
 * The renderer's docking rule (ADR 0026 amendment): jsdom evaluates neither :has() nor the frame
 * math, so this pins the rule's text. chat-content-layout.unit.test.ts pins the same names on the
 * renderer side, and SessionSummaryExpandedPanel sets the persistent mode it matches.
 */
describe('the Session Summary docking rule in globals.css', () => {
  it('re-centers every conversation frame by the reserve while a persistent Summary is docked', () => {
    const css = readFileSync(GLOBALS_CSS_URL, 'utf8')
    const selector =
      '.session-summary-docking:has(> div > aside[data-session-summary-mode="persistent"])'
    const start = css.indexOf(selector)
    expect(start).toBeGreaterThan(-1)
    const rule = css.slice(start, css.indexOf('}', start)).replace(/\s+/g, ' ')
    expect(rule).toContain('.chat-content-frame {')
    expect(rule).toContain(
      'max-width: min(calc(var(--spacing) * 180), 100% - var(--session-summary-reserve, 0px));',
    )
    expect(rule).toContain('margin-left: calc(')
  })

  it('is unlayered, so it overrides the frames’ mx-auto and max-w-180 utilities', () => {
    const css = readFileSync(GLOBALS_CSS_URL, 'utf8')
    const start = css.indexOf('.session-summary-docking:has(')
    const before = css.slice(0, start)
    const opened = (before.match(/\{/g) ?? []).length
    const closed = (before.match(/\}/g) ?? []).length
    expect(opened - closed).toBe(0)
  })
})
