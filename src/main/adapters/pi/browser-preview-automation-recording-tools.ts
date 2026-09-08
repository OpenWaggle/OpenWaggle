import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent'
import type {
  BrowserPreviewAutomationScope,
  BrowserPreviewAutomationServiceShape,
} from '../../ports/browser-preview-automation-service'
import { previewTabTargetParameters } from './browser-preview-automation-schemas-core'
import {
  authorizeBrowserPreviewTool,
  browserPreviewTextResult,
  deniedBrowserPreviewResult,
  runBrowserPreviewEffect,
} from './browser-preview-automation-tool-support'

interface RegistrationInput {
  readonly pi: ExtensionAPI
  readonly scope: BrowserPreviewAutomationScope
  readonly service: BrowserPreviewAutomationServiceShape
}

async function approved<T>(input: {
  readonly operation: string
  readonly params: unknown
  readonly signal?: AbortSignal
  readonly ctx: ExtensionContext
  readonly execute: () => Promise<T>
}) {
  const allowed = await authorizeBrowserPreviewTool(input)
  return allowed
    ? browserPreviewTextResult(input.operation, await input.execute())
    : deniedBrowserPreviewResult(input.operation)
}

export function registerBrowserPreviewRecordingTools(input: RegistrationInput) {
  input.pi.registerTool({
    name: 'preview_recording_start',
    label: 'Start browser recording',
    description: 'Start a bounded recording of the collaborative browser tab.',
    parameters: previewTabTargetParameters,
    executionMode: 'sequential',
    execute: (_id, params, signal, _update, ctx) =>
      approved({
        operation: 'start browser preview recording',
        params,
        signal,
        ctx,
        execute: () =>
          runBrowserPreviewEffect(input.service.startRecording(input.scope, params), signal),
      }),
  })

  input.pi.registerTool({
    name: 'preview_recording_stop',
    label: 'Stop browser recording',
    description: 'Stop the active browser recording and save it as a local evidence artifact.',
    parameters: previewTabTargetParameters,
    executionMode: 'sequential',
    execute: (_id, params, signal, _update, ctx) =>
      approved({
        operation: 'stop browser preview recording',
        params,
        signal,
        ctx,
        execute: () =>
          runBrowserPreviewEffect(input.service.stopRecording(input.scope, params), signal),
      }),
  })
}
