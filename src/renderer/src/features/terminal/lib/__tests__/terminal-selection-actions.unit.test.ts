import { describe, expect, it } from 'vitest'
import { resolveTerminalSelectionActionPosition } from '../terminal-selection-actions'

describe('terminal selection action position', () => {
  it('anchors to the selection end and keeps the whole toolbar inside terminal and viewport', () => {
    expect(
      resolveTerminalSelectionActionPosition({
        bounds: { left: 100, top: 40, width: 300, height: 200 },
        selectionRect: { right: 390, bottom: 230 },
        pointer: null,
        viewport: { width: 360, height: 220 },
        actionSize: { width: 140, height: 30 },
      }),
    ).toEqual({ x: 212, y: 182 })
  })

  it('prefers the release point while clamping it to the terminal bounds', () => {
    expect(
      resolveTerminalSelectionActionPosition({
        bounds: { left: 80, top: 30, width: 500, height: 300 },
        selectionRect: null,
        pointer: { x: 20, y: 10 },
        viewport: { width: 800, height: 600 },
        actionSize: { width: 150, height: 30 },
      }),
    ).toEqual({ x: 80, y: 30 })
  })
})
