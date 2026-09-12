import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent'
import type {
  BrowserPreviewAutomationScope,
  BrowserPreviewAutomationServiceShape,
} from '../../ports/browser-preview-automation-service'
import {
  previewAppearanceParameters,
  previewNavigateParameters,
  previewOpenParameters,
  previewResizeParameters,
} from './browser-preview-automation-schemas-core'
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

export function registerBrowserPreviewNavigationTools(input: RegistrationInput) {
  input.pi.registerTool({
    name: 'preview_open',
    label: 'Open browser preview',
    description:
      'Initialize a collaborative browser tab. It opens in this session by default; set open=false for background-only automation.',
    promptSnippet: 'Open and drive the session-owned collaborative browser preview.',
    parameters: previewOpenParameters,
    executionMode: 'sequential',
    execute: (_id, params, signal, _update, ctx) =>
      approved({
        operation: 'open browser preview',
        params,
        signal,
        ctx,
        execute: () => runBrowserPreviewEffect(input.service.open(input.scope, params), signal),
      }),
  })

  input.pi.registerTool({
    name: 'preview_navigate',
    label: 'Navigate browser preview',
    description:
      'Navigate a collaborative browser tab to one direct URL or one environment-relative dev-server port.',
    parameters: previewNavigateParameters,
    executionMode: 'sequential',
    execute: (_id, params, signal, _update, ctx) =>
      approved({
        operation: 'navigate browser preview',
        params,
        signal,
        ctx,
        execute: () => runBrowserPreviewEffect(input.service.navigate(input.scope, params), signal),
      }),
  })

  input.pi.registerTool({
    name: 'preview_resize',
    label: 'Resize browser viewport',
    description:
      'Set fill-panel sizing, exact freeform dimensions, or a named responsive device preset.',
    parameters: previewResizeParameters,
    executionMode: 'sequential',
    execute: (_id, params, signal, _update, ctx) =>
      approved({
        operation: 'resize browser preview',
        params,
        signal,
        ctx,
        execute: () => runBrowserPreviewEffect(input.service.resize(input.scope, params), signal),
      }),
  })

  input.pi.registerTool({
    name: 'preview_set_appearance',
    label: 'Set preview appearance',
    description: 'Emulate the page prefers-color-scheme as system, light, or dark.',
    parameters: previewAppearanceParameters,
    executionMode: 'sequential',
    execute: (_id, params, signal, _update, ctx) =>
      approved({
        operation: 'set browser preview appearance',
        params,
        signal,
        ctx,
        execute: () =>
          runBrowserPreviewEffect(input.service.setAppearance(input.scope, params), signal),
      }),
  })
}
