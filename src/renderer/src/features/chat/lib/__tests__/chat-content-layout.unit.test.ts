import { describe, expect, it } from 'vitest'
import {
  CHAT_CONTENT_FRAME_CLASS,
  SESSION_SUMMARY_DOCKED_CHAT_CLASS,
  SESSION_SUMMARY_FOOTPRINT_PX,
  SESSION_SUMMARY_RESERVE_PROPERTY,
  sessionSummaryReservePx,
} from '../chat-content-layout'

describe('sessionSummaryReservePx', () => {
  it('reserves the least width that keeps the centered conversation clear of a docked Summary', () => {
    expect(SESSION_SUMMARY_FOOTPRINT_PX).toBe(332)
    // Narrow panels give up the whole footprint; the frame fills what is left.
    expect(sessionSummaryReservePx(752)).toBe(332)
    expect(sessionSummaryReservePx(840)).toBe(332)
    // Medium panels keep the 720px frame and move it left.
    expect(sessionSummaryReservePx(1_080)).toBe(304)
    expect(sessionSummaryReservePx(1_368)).toBe(16)
    // From 2 * 332 + 720 there is room beside the centered frame.
    expect(sessionSummaryReservePx(1_384)).toBe(0)
    expect(sessionSummaryReservePx(1_920)).toBe(0)
  })

  it('leaves a centered frame ending at the Summary gap', () => {
    for (const width of [800, 1_000, 1_080, 1_200, 1_368]) {
      const reserve = sessionSummaryReservePx(width)
      const frame = Math.min(720, width - reserve)
      const frameRight = (width - reserve + frame) / 2
      expect(frameRight).toBeLessThanOrEqual(width - SESSION_SUMMARY_FOOTPRINT_PX)
    }
  })
})

describe('the names the docking rule in globals.css keys on', () => {
  // scripts/__tests__/session-summary-docking-css.unit.test.ts reads the rule with these names.
  it('keeps the class, frame marker and property names the rule uses', () => {
    expect(SESSION_SUMMARY_DOCKED_CHAT_CLASS).toBe('session-summary-docking')
    expect(SESSION_SUMMARY_RESERVE_PROPERTY).toBe('--session-summary-reserve')
    expect(CHAT_CONTENT_FRAME_CLASS.split(' ')).toContain('chat-content-frame')
  })
})
