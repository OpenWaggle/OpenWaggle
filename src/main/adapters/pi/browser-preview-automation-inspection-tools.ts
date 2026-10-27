import type { AgentToolResult, ExtensionAPI } from '@earendil-works/pi-coding-agent'
import type {
  BrowserPreviewAutomationScope,
  BrowserPreviewAutomationServiceShape,
} from '../../ports/browser-preview-automation-service'
import {
  previewSnapshotParameters,
  previewTabTargetParameters,
} from './browser-preview-automation-schemas-core'
import { boundedBrowserPreviewSnapshotSummary } from './browser-preview-automation-snapshot-result'
import {
  authorizeBrowserPreviewTool,
  type BrowserPreviewToolDetails,
  browserPreviewTextResult,
  deniedBrowserPreviewResult,
  runBrowserPreviewEffect,
} from './browser-preview-automation-tool-support'

/**
 * The entry point of the on-demand preview tools, so it carries the guidance that used to be a
 * system prompt appendix on every request.
 */
const BROWSER_PREVIEW_STATUS_DESCRIPTION = [
  "Report this Session's collaborative browser preview tab: URL, title, loading state, visibility, appearance, and viewport. Start browser work here, then preview_open if no tab exists (an omitted tabId targets the current preview), preview_navigate for another URL, and preview_snapshot to inspect the page.",
  'Prefer semantic locators such as role=button[name="Save"] or stable CSS selectors over coordinates; click and type wait for their targets, and preview_wait_for waits for explicit conditions. Snapshot again after navigation or a large UI change.',
  'If a preview action fails, diagnose this preview instead of switching to another browser integration: the user sees and can take over the same page, and their input wins immediately. Record (preview_recording_start/stop) only when a bounded visual trace helps.',
].join(' ')

interface RegistrationInput {
  readonly pi: Pick<ExtensionAPI, 'registerTool'>
  readonly scope: BrowserPreviewAutomationScope
  readonly service: BrowserPreviewAutomationServiceShape
}

export function registerBrowserPreviewInspectionTools(input: RegistrationInput) {
  input.pi.registerTool({
    name: 'preview_status',
    label: 'Get preview status',
    description: BROWSER_PREVIEW_STATUS_DESCRIPTION,
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
      'Inspect the page: visible text, interactive elements, and a PNG screenshot. Add include for the accessibility tree, console, network, or action history.',
    parameters: previewSnapshotParameters,
    executionMode: 'sequential',
    async execute(_id, params, signal, _update, ctx) {
      const operation = 'inspect browser preview page'
      if (!(await authorizeBrowserPreviewTool({ operation, params, signal, ctx }))) {
        return deniedBrowserPreviewResult(operation)
      }
      const { include, ...target } = params
      const snapshot = await runBrowserPreviewEffect(
        input.service.snapshot(input.scope, target),
        signal,
      )
      const summary = boundedBrowserPreviewSnapshotSummary(snapshot, include)
      return {
        content: [
          { type: 'text', text: JSON.stringify(summary) },
          ...(snapshot.screenshot
            ? [{ type: 'image' as const, data: snapshot.screenshot.data, mimeType: 'image/png' }]
            : []),
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
