import { createStackParser, nodeStackLineParser } from '@sentry/core'
import {
  isOwnErrorReportCodeLocation,
  scrubErrorReportCodeLocation,
} from '@shared/error-reporting/error-report-rules'
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: {}, net: {}, protocol: {} }))
vi.mock('@electron-toolkit/utils', () => ({ is: { dev: false } }))

import { RENDERER_PROTOCOL_ORIGIN } from '../renderer-protocol'

/*
 * The error-report rules stay dependency-free for the statistics endpoint, so they spell out the
 * renderer's origin themselves; this keeps the two from drifting apart.
 */
describe("error reports and the app's own code", () => {
  it("count the renderer's documents as the app's own code", () => {
    const location = `${RENDERER_PROTOCOL_ORIGIN}/assets/index.js`

    expect(isOwnErrorReportCodeLocation(location)).toBe(true)
    expect(scrubErrorReportCodeLocation(location)).toBe(location)
    expect(isOwnErrorReportCodeLocation(`${RENDERER_PROTOCOL_ORIGIN}.example/x.js`)).toBe(false)
  })

  it("count V8's Promise.all element location as a pseudo-location", () => {
    const frames = createStackParser(nodeStackLineParser())(
      ['Error: boom', '    at async Promise.all (index 0)'].join('\n'),
    )

    expect(frames.map((frame) => frame.filename)).toEqual(['index 0'])
    expect(isOwnErrorReportCodeLocation('index 0')).toBe(true)
  })
})
