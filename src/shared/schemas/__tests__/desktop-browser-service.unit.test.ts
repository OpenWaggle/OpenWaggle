import { parseJsonUnknown } from '@shared/schema'
import type { DesktopBrowserOperation } from '@shared/types/desktop-browser-service'
import { describe, expect, expectTypeOf, it } from 'vitest'
import type { BrowserPreviewAutomationServiceShape } from '../../../main/ports/browser-preview-automation-service'
import { decodeDesktopBrowserCommand, decodeDesktopBrowserResult } from '../desktop-browser-service'
import { inputs, scope, snapshot, values } from './desktop-browser-service.test-fixtures'

describe('desktop browser service boundary', () => {
  it('covers exactly the native service operations', () => {
    expectTypeOf<DesktopBrowserOperation>().toEqualTypeOf<
      keyof BrowserPreviewAutomationServiceShape
    >()
    expect(Object.keys(inputs)).toHaveLength(14)
    expect(Object.keys(values)).toEqual(Object.keys(inputs))
  })

  it.each(Object.entries(inputs))(
    'round-trips the %s command without losing its typed input',
    (operation, input) => {
      const command = { service: 'browser', operation, scope, input }
      expect(decodeDesktopBrowserCommand(parseJsonUnknown(JSON.stringify(command)))).toEqual(
        command,
      )
    },
  )

  it.each(Object.entries(values))('round-trips the %s result', (operation, value) => {
    const result = { service: 'browser', operation, value }
    expect(decodeDesktopBrowserResult(parseJsonUnknown(JSON.stringify(result)))).toEqual(result)
  })

  it.each([
    { operation: 'unknown', input: {} },
    { operation: 'status', input: { expression: 'malicious' } },
    { operation: 'open', input: { scope: { sessionId: 'another-session' } } },
    { operation: 'navigate', input: { target: { kind: 'environment-port', port: 65536 } } },
    { operation: 'resize', input: { mode: 'freeform', width: Number.NaN, height: 10 } },
    { operation: 'press', input: { key: 'Enter', modifiers: ['Admin'] } },
    { operation: 'waitFor', input: { text: 'Ready', timeoutMs: 60001 } },
    { operation: 'evaluate', input: { expression: 'x'.repeat(64001) } },
    { operation: 'type', input: { text: 'hello', permission: 'yolo' } },
  ])('rejects invalid $operation input', ({ operation, input }) => {
    expect(() =>
      decodeDesktopBrowserCommand({ service: 'browser', operation, scope, input }),
    ).toThrow()
  })

  it.each([
    { sessionId: '', workingPath: '/repo' },
    { sessionId: 'worker', workingPath: '' },
    { sessionId: 'worker', workingPath: '/repo\0swap' },
    { ...scope, unrestricted: true },
  ])('rejects malformed or extended trusted scope %#', (invalidScope) => {
    expect(() =>
      decodeDesktopBrowserCommand({
        service: 'browser',
        operation: 'status',
        scope: invalidScope,
        input: {},
      }),
    ).toThrow()
  })

  it.each([
    { operation: 'status', value: null },
    { operation: 'click', value: { available: true } },
    { operation: 'startRecording', value: { tabId: 'tab', recording: true } },
    { operation: 'evaluate', value: undefined },
    { operation: 'evaluate', value: { bad: () => 'not JSON' } },
    { operation: 'evaluate', value: { bad: Number.NaN } },
    { operation: 'evaluate', value: '😀'.repeat(17000) },
    {
      operation: 'snapshot',
      value: { ...snapshot, screenshot: { ...snapshot.screenshot, data: 'not-base64' } },
    },
    {
      operation: 'snapshot',
      value: { ...snapshot, screenshot: { ...snapshot.screenshot, width: 16777216, height: 2 } },
    },
    {
      operation: 'snapshot',
      value: {
        ...snapshot,
        interactiveElements: Array.from({ length: 513 }, () => snapshot.interactiveElements[0]),
      },
    },
    { operation: 'resize', value: { tabId: 'tab', viewport: { mode: 'fill', width: 100 } } },
  ])('rejects malformed $operation result %#', ({ operation, value }) => {
    expect(() => decodeDesktopBrowserResult({ service: 'browser', operation, value })).toThrow()
  })

  it('preserves substantial accessibility data independently of the smaller evaluate limit', () => {
    const value = {
      ...snapshot,
      accessibilityTree: { nodes: [{ description: 'x'.repeat(70000) }] },
    }
    expect(
      decodeDesktopBrowserResult({ service: 'browser', operation: 'snapshot', value }),
    ).toEqual({ service: 'browser', operation: 'snapshot', value })
  })
})
