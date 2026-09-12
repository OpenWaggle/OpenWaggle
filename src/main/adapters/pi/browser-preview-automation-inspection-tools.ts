import type { AgentToolResult, ExtensionAPI } from '@earendil-works/pi-coding-agent'
import type {
  BrowserPreviewAutomationScope,
  BrowserPreviewAutomationServiceShape,
} from '../../ports/browser-preview-automation-service'
import { previewTabTargetParameters } from './browser-preview-automation-schemas-core'
import { boundedBrowserPreviewSnapshotSummary } from './browser-preview-automation-snapshot-result'
import {
  authorizeBrowserPreviewTool,
  type BrowserPreviewToolDetails,
  browserPreviewTextResult,
  deniedBrowserPreviewResult,
  runBrowserPreviewEffect,
} from './browser-preview-automation-tool-support'

interface RegistrationInput {
  readonly pi: ExtensionAPI
  readonly scope: BrowserPreviewAutomationScope
  readonly service: BrowserPreviewAutomationServiceShape
}

export function registerBrowserPreviewInspectionTools(input: RegistrationInput) {
  input.pi.registerTool({
    name: 'preview_status',
    label: 'Get preview status',
    description:
      'Report the current session-owned collaborative browser tab, URL, title, loading state, visibility, appearance, and viewport.',
    promptSnippet:
      'For browser work, call preview_status first, then preview_open if no tab is available.',
    parameters: previewTabTargetParameters,
    executionMode: 'sequential',
    async execute(_id, params, signal) {
      const status = await runBrowserPreviewEffect(
        input.service.status(input.scope, params),
        signal,
      )
      return browserPreviewTextResult('get browser preview status', status)
    },
  })

  input.pi.registerTool({
    name: 'preview_snapshot',
    label: 'Inspect browser page',
    description:
      'Inspect page text, semantic elements, accessibility data, diagnostics, action history, and a PNG screenshot.',
    parameters: previewTabTargetParameters,
    executionMode: 'sequential',
    async execute(_id, params, signal, _update, ctx) {
      const operation = 'inspect browser preview page'
      if (!(await authorizeBrowserPreviewTool({ operation, params, signal, ctx }))) {
        return deniedBrowserPreviewResult(operation)
      }
      const snapshot = await runBrowserPreviewEffect(
        input.service.snapshot(input.scope, params),
        signal,
      )
      const { data } = snapshot.screenshot
      const summary = boundedBrowserPreviewSnapshotSummary(snapshot)
      return {
        content: [
          { type: 'text', text: JSON.stringify(summary) },
          { type: 'image', data, mimeType: 'image/png' },
        ],
        details: {
          kind: 'browser-preview',
          operation,
          result: summary,
        },
      } satisfies AgentToolResult<BrowserPreviewToolDetails>
    },
  })
}
