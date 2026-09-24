import { isIPv4 } from 'node:net'
import { stripVTControlCharacters } from 'node:util'
import type { ActionOutputSnapshot, ActionRun } from '@shared/types/action-runs'
import { normalizeBrowserPreviewAddress } from '@shared/utils/browser-preview-url'

const OUTPUT_PAGE_BYTES = 64 * 1_024
const UTF8_CONTINUATION_MASK = 0xc0
const UTF8_CONTINUATION_TAG = 0x80

export function actionOutputPage(
  run: ActionRun,
  output: string,
  afterOffset: number,
  retainedEndOffset: number | null = null,
): ActionOutputSnapshot {
  const retained = Buffer.from(output)
  const knownTotal = Math.max(run.outputBytes, retainedEndOffset ?? 0, retained.length)
  // A crash can also lose an unflushed tail that the renderer already saw.
  // Keep that cursor stable instead of clearing its still-visible output.
  const total = Math.max(knownTotal, afterOffset)
  const retainedStart = total - retained.length
  const requested = Math.min(total, Math.max(retainedStart, afterOffset))
  let start = requested - retainedStart
  while (
    start < retained.length &&
    (retained[start] & UTF8_CONTINUATION_MASK) === UTF8_CONTINUATION_TAG
  )
    start += 1
  let end = Math.min(retained.length, start + OUTPUT_PAGE_BYTES)
  while (
    end < retained.length &&
    (retained[end] & UTF8_CONTINUATION_MASK) === UTF8_CONTINUATION_TAG
  )
    end -= 1
  return {
    run,
    output: retained.subarray(start, end).toString('utf8'),
    startOffset: retainedStart + start,
    endOffset: retainedStart + end,
    truncated: afterOffset < retainedStart || afterOffset > knownTotal,
    hasMore: end < retained.length,
  }
}

/** Only a loopback endpoint printed by this run is eligible for automatic preview. */
export function previewFromActionOutput(text: string): string | null {
  let detected: string | null = null
  for (const match of stripVTControlCharacters(text).matchAll(/https?:\/\/[^\s<>"'`]+/g)) {
    const value = match[0].replace(/[),.;\]}]+$/, '')
    const normalized = normalizeBrowserPreviewAddress(value)
    if (!normalized) continue
    const url = new URL(normalized)
    if (url.hostname === '0.0.0.0' || url.hostname === '[::]') url.hostname = 'localhost'
    if (
      url.hostname === 'localhost' ||
      url.hostname === '[::1]' ||
      (isIPv4(url.hostname) && url.hostname.startsWith('127.'))
    )
      detected = url.href
  }
  return detected
}
