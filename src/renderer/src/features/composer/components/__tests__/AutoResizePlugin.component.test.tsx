import { LexicalComposer } from '@lexical/react/LexicalComposer'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { ContentEditable } from '@lexical/react/LexicalContentEditable'
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary'
import { PlainTextPlugin } from '@lexical/react/LexicalPlainTextPlugin'
import { act, render, screen } from '@testing-library/react'
import { fromPartial } from '@total-typescript/shoehorn'
import { $createParagraphNode, $createTextNode, $getRoot, type LexicalEditor } from 'lexical'
import { useEffect } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AutoResizePlugin } from '../plugins/AutoResizePlugin'

const observers: { callback: ResizeObserverCallback; observer: ResizeObserver }[] = []

function resize(width: number) {
  for (const { callback, observer } of observers) {
    callback(
      [fromPartial<ResizeObserverEntry>({ contentRect: fromPartial<DOMRectReadOnly>({ width }) })],
      observer,
    )
  }
}

function EditorProbe({ onEditor }: { readonly onEditor: (editor: LexicalEditor) => void }) {
  const [editor] = useLexicalComposerContext()
  useEffect(() => onEditor(editor), [editor, onEditor])
  return null
}

function renderEditor() {
  const mounted: { editor: LexicalEditor | null } = { editor: null }
  render(
    <LexicalComposer
      initialConfig={{
        namespace: 'auto-resize-test',
        onError: (error) => {
          throw error
        },
      }}
    >
      <PlainTextPlugin
        contentEditable={<ContentEditable aria-label="Message input" />}
        placeholder={null}
        ErrorBoundary={LexicalErrorBoundary}
      />
      <EditorProbe
        onEditor={(editor) => {
          mounted.editor = editor
        }}
      />
      <AutoResizePlugin />
    </LexicalComposer>,
  )
  const root = screen.getByLabelText('Message input')
  const measure = vi.fn(() => 40)
  Object.defineProperty(root, 'scrollHeight', { configurable: true, get: measure })
  const { editor } = mounted
  if (!editor) throw new Error('The editor did not mount')
  return { editor, root, measure }
}

function write(editor: LexicalEditor, text: string) {
  act(() => {
    editor.update(
      () => {
        const paragraph = $createParagraphNode()
        paragraph.append($createTextNode(text))
        $getRoot().clear().append(paragraph)
      },
      { discrete: true },
    )
  })
}

describe('AutoResizePlugin', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: ResizeObserverCallback) {
          observers.push({ callback, observer: fromPartial<ResizeObserver>(this) })
        }
        observe() {}
        disconnect() {}
      },
    )
  })

  afterEach(() => {
    observers.length = 0
    vi.unstubAllGlobals()
  })

  it('fits the editor to its text when the text changes', () => {
    const { editor, root, measure } = renderEditor()

    write(editor, 'Hello')

    expect(measure).toHaveBeenCalledTimes(1)
    expect(root.style.height).toBe('40px')
    expect(root.style.overflowY).toBe('hidden')
  })

  it('measures again when the width changes, not when only the height set here does', () => {
    const { root, measure } = renderEditor()

    resize(400)
    resize(400)
    expect(measure).toHaveBeenCalledTimes(1)

    resize(300)
    expect(measure).toHaveBeenCalledTimes(2)
    expect(root.style.height).toBe('40px')
  })

  it('does not measure for an update that only moves the selection', () => {
    const { editor, measure } = renderEditor()
    write(editor, 'Hello')
    measure.mockClear()

    act(() => {
      editor.update(() => $getRoot().selectEnd(), { discrete: true })
    })

    expect(measure).not.toHaveBeenCalled()
  })
})
