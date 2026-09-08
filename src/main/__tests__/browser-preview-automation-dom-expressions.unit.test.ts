// @vitest-environment jsdom

import { runInThisContext } from 'node:vm'
import { describe, expect, it } from 'vitest'
import {
  browserPreviewScrollExpression,
  browserPreviewTypeExpression,
  browserPreviewWaitExpression,
} from '../browser-preview-automation-dom-expressions'

describe('browser preview automation DOM expressions', () => {
  function runTypeExpression(text: string, clear: boolean) {
    const result: unknown = runInThisContext(browserPreviewTypeExpression({ text, clear }))
    return result
  }

  it('embeds type text as JSON rather than executable source', () => {
    const text = `'); globalThis.compromised = true; ('`
    const expression = browserPreviewTypeExpression({ text, selector: '#editor' })

    expect(expression).toContain(JSON.stringify(text))
    expect(expression).not.toContain(`const text = '${text}'`)
  })

  it('sets input values through the native setter and emits bubbling input events', () => {
    document.body.innerHTML = '<input value="old value">'
    const input = document.querySelector('input')
    if (!(input instanceof HTMLInputElement)) throw new Error('Expected input fixture.')
    const events: string[] = []
    input.addEventListener('input', (event) =>
      events.push(`${event.type}:${String(event.bubbles)}`),
    )
    input.addEventListener('change', (event) =>
      events.push(`${event.type}:${String(event.bubbles)}`),
    )
    Reflect.set(document, 'execCommand', () => false)
    input.focus()

    expect(runTypeExpression('new value', true)).toEqual({ kind: 'ok' })
    expect(input.value).toBe('new value')
    expect(events).toEqual(['input:true', 'change:true'])
  })

  it('sets textarea values through the native setter at the selected range', () => {
    document.body.innerHTML = '<textarea>before after</textarea>'
    const textarea = document.querySelector('textarea')
    if (!(textarea instanceof HTMLTextAreaElement)) {
      throw new Error('Expected textarea fixture.')
    }
    textarea.focus()
    textarea.setSelectionRange(7, 12)

    expect(runTypeExpression('during', false)).toEqual({ kind: 'ok' })
    expect(textarea.value).toBe('before during')
  })

  it('replaces contenteditable contents and emits bubbling edit events', () => {
    document.body.innerHTML = '<div contenteditable="true">old <strong>value</strong></div>'
    const editor = document.querySelector('div')
    if (!(editor instanceof HTMLElement)) throw new Error('Expected editor fixture.')
    Object.defineProperty(editor, 'isContentEditable', { configurable: true, value: true })
    const events: string[] = []
    editor.addEventListener('input', (event) =>
      events.push(`${event.type}:${String(event.bubbles)}`),
    )
    editor.addEventListener('change', (event) =>
      events.push(`${event.type}:${String(event.bubbles)}`),
    )
    editor.focus()

    expect(runTypeExpression('replacement', true)).toEqual({ kind: 'ok' })
    expect(editor.textContent).toBe('replacement')
    expect(events).toEqual(['input:true', 'change:true'])
  })

  it('replaces the active contenteditable selection without clearing surrounding content', () => {
    document.body.innerHTML = '<div contenteditable="true">before middle after</div>'
    const editor = document.querySelector('div')
    if (!(editor instanceof HTMLElement)) throw new Error('Expected editor fixture.')
    Object.defineProperty(editor, 'isContentEditable', { configurable: true, value: true })
    const textNode = editor.firstChild
    const selection = document.getSelection()
    if (textNode === null || selection === null) throw new Error('Expected selection fixture.')
    editor.focus()
    const range = document.createRange()
    range.setStart(textNode, 7)
    range.setEnd(textNode, 13)
    selection.removeAllRanges()
    selection.addRange(range)

    expect(runTypeExpression('during', false)).toEqual({ kind: 'ok' })
    expect(editor.textContent).toBe('before during after')
  })

  it('does not report success when a native control setter fails to change the value', () => {
    document.body.innerHTML = '<input value="old value">'
    const input = document.querySelector('input')
    if (!(input instanceof HTMLInputElement)) throw new Error('Expected input fixture.')
    const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')
    if (descriptor === undefined) throw new Error('Expected native input value descriptor.')
    Object.defineProperty(HTMLInputElement.prototype, 'value', {
      ...descriptor,
      set: () => undefined,
    })
    input.focus()

    try {
      expect(runTypeExpression('new value', true)).toEqual({ kind: 'not-editable' })
    } finally {
      Object.defineProperty(HTMLInputElement.prototype, 'value', descriptor)
    }
  })

  it('does not report success when contenteditable clearing fails', () => {
    document.body.innerHTML = '<div contenteditable="true">old value</div>'
    const editor = document.querySelector('div')
    if (!(editor instanceof HTMLElement)) throw new Error('Expected editor fixture.')
    Object.defineProperty(editor, 'isContentEditable', { configurable: true, value: true })
    Reflect.set(editor, 'replaceChildren', () => undefined)
    editor.focus()

    expect(runTypeExpression('', true)).toEqual({ kind: 'not-editable' })
    expect(editor.textContent).toBe('old value')
  })

  it('does not report success when contenteditable insertion fails', () => {
    document.body.innerHTML = '<div contenteditable="true"></div>'
    const editor = document.querySelector('div')
    if (!(editor instanceof HTMLElement)) throw new Error('Expected editor fixture.')
    Object.defineProperty(editor, 'isContentEditable', { configurable: true, value: true })
    const descriptor = Object.getOwnPropertyDescriptor(Range.prototype, 'insertNode')
    if (descriptor === undefined) throw new Error('Expected native range insertion descriptor.')
    Object.defineProperty(Range.prototype, 'insertNode', {
      ...descriptor,
      value: () => undefined,
    })
    editor.focus()

    try {
      expect(runTypeExpression('new value', false)).toEqual({ kind: 'not-editable' })
    } finally {
      Object.defineProperty(Range.prototype, 'insertNode', descriptor)
    }
    expect(editor.textContent).toBe('')
  })

  it('normalizes CSS targets through the Playwright injected runtime', () => {
    const expression = browserPreviewScrollExpression({ selector: '[data-row="a"]', deltaY: 42 })

    expect(expression).toContain('css=[data-row=\\"a\\"]')
    expect(expression).toContain('querySelector')
  })

  it('combines every supplied wait condition', () => {
    const expression = browserPreviewWaitExpression({
      locator: 'role=button[name="Save"]',
      text: 'Saved',
      urlIncludes: '/settings',
    })

    expect(expression).toContain('querySelector')
    expect(expression).toContain('document, false')
    expect(expression).toContain('.includes("Saved")')
    expect(expression).toContain('.includes("/settings")')
  })
})
