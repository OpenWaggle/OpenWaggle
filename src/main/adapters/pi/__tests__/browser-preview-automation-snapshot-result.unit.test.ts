import { Buffer } from 'node:buffer'
import type { BrowserPreviewAutomationSnapshot } from '@shared/types/browser-preview-automation'
import { BROWSER_PREVIEW_AUTOMATION_LIMITS } from '@shared/types/browser-preview-automation'
import { describe, expect, it } from 'vitest'
import { boundedBrowserPreviewSnapshotSummary } from '../browser-preview-automation-snapshot-result'

function oversizedSnapshot(): BrowserPreviewAutomationSnapshot {
  const diagnosticText = 'diagnostic '.repeat(1_000)
  return {
    url: 'http://localhost:5173/',
    title: 'Application',
    loading: false,
    visibleText: 'content '.repeat(20_000),
    interactiveElements: Array.from({ length: 512 }, (_, index) => ({
      tag: 'button',
      role: 'button',
      name: `Save ${String(index)} ${diagnosticText}`,
      selector: `#save-${String(index)}-${diagnosticText}`,
      x: index,
      y: index,
      width: 80,
      height: 24,
    })),
    accessibilityTree: { nodes: Array.from({ length: 512 }, () => diagnosticText) },
    consoleEntries: Array.from({ length: 256 }, () => ({
      level: 'log',
      text: diagnosticText,
      timestamp: '2026-09-05T00:00:00.000Z',
    })),
    networkEntries: Array.from({ length: 256 }, () => ({
      url: `https://example.com/${diagnosticText}`,
      method: 'GET',
      status: 200,
      failed: false,
      timestamp: '2026-09-05T00:00:00.000Z',
    })),
    actionTimeline: [],
    screenshot: {
      mimeType: 'image/png',
      data: 'not-in-summary',
      width: 1_200,
      height: 800,
    },
  }
}

describe('boundedBrowserPreviewSnapshotSummary', () => {
  it('retains useful metadata while staying below the Pi text-result ceiling', () => {
    const summary = boundedBrowserPreviewSnapshotSummary(oversizedSnapshot())
    const serialized = JSON.stringify(summary)

    expect(Buffer.byteLength(serialized)).toBeLessThanOrEqual(
      BROWSER_PREVIEW_AUTOMATION_LIMITS.RESULT_BYTES,
    )
    expect(serialized).not.toContain('not-in-summary')
    expect(summary).toMatchObject({
      url: 'http://localhost:5173/',
      screenshot: { mimeType: 'image/png', width: 1_200, height: 800 },
      truncatedFields: expect.arrayContaining(['accessibilityTree']),
    })
  })
})
