import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent'
import type {
  BrowserPreviewAutomationScope,
  BrowserPreviewAutomationServiceShape,
} from '../../ports/browser-preview-automation-service'
import {
  previewClickParameters,
  previewEvaluateParameters,
  previewPressParameters,
  previewScrollParameters,
  previewTypeParameters,
  previewWaitParameters,
} from './browser-preview-automation-schemas-interactions'
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

export function registerBrowserPreviewInteractionTools(input: RegistrationInput) {
  input.pi.registerTool({
    name: 'preview_click',
    label: 'Click preview page',
    description:
      'Click exactly one semantic locator, CSS selector, or viewport-relative coordinate pair.',
    parameters: previewClickParameters,
    executionMode: 'sequential',
    execute: (_id, params, signal, _update, ctx) =>
      approved({
        operation: 'click browser preview page',
        params,
        signal,
        ctx,
        execute: () => runBrowserPreviewEffect(input.service.click(input.scope, params), signal),
      }),
  })

  input.pi.registerTool({
    name: 'preview_type',
    label: 'Type into preview page',
    description:
      'Insert literal text into a semantic locator, CSS selector, or the currently focused input.',
    parameters: previewTypeParameters,
    executionMode: 'sequential',
    execute: (_id, params, signal, _update, ctx) =>
      approved({
        operation: 'type into browser preview page',
        params,
        signal,
        ctx,
        execute: () => runBrowserPreviewEffect(input.service.type(input.scope, params), signal),
      }),
  })

  input.pi.registerTool({
    name: 'preview_press',
    label: 'Press key in preview page',
    description: 'Press one keyboard key with optional Alt, Control, Meta, or Shift modifiers.',
    parameters: previewPressParameters,
    executionMode: 'sequential',
    execute: (_id, params, signal, _update, ctx) =>
      approved({
        operation: 'press key in browser preview page',
        params,
        signal,
        ctx,
        execute: () => runBrowserPreviewEffect(input.service.press(input.scope, params), signal),
      }),
  })

  input.pi.registerTool({
    name: 'preview_scroll',
    label: 'Scroll preview page',
    description: 'Scroll the page or one semantic locator/CSS selector by CSS-pixel deltas.',
    parameters: previewScrollParameters,
    executionMode: 'sequential',
    execute: (_id, params, signal, _update, ctx) =>
      approved({
        operation: 'scroll browser preview page',
        params,
        signal,
        ctx,
        execute: () => runBrowserPreviewEffect(input.service.scroll(input.scope, params), signal),
      }),
  })

  input.pi.registerTool({
    name: 'preview_evaluate',
    label: 'Evaluate JavaScript in preview',
    description:
      'Evaluate a bounded JavaScript expression in the page. Prefer semantic tools for ordinary interactions.',
    parameters: previewEvaluateParameters,
    executionMode: 'sequential',
    execute: (_id, params, signal, _update, ctx) =>
      approved({
        operation: 'evaluate JavaScript in browser preview',
        params,
        signal,
        ctx,
        execute: () => runBrowserPreviewEffect(input.service.evaluate(input.scope, params), signal),
      }),
  })

  input.pi.registerTool({
    name: 'preview_wait_for',
    label: 'Wait for preview page condition',
    description:
      'Wait until every supplied semantic locator, CSS selector, text, and URL condition matches.',
    parameters: previewWaitParameters,
    executionMode: 'sequential',
    execute: (_id, params, signal, _update, ctx) =>
      approved({
        operation: 'wait for browser preview condition',
        params,
        signal,
        ctx,
        execute: () => runBrowserPreviewEffect(input.service.waitFor(input.scope, params), signal),
      }),
  })
}
