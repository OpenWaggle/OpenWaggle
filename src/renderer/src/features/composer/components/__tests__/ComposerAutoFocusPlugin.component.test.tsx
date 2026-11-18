import { LexicalComposer } from '@lexical/react/LexicalComposer'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { ContentEditable } from '@lexical/react/LexicalContentEditable'
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary'
import { PlainTextPlugin } from '@lexical/react/LexicalPlainTextPlugin'
import { render, screen, waitFor } from '@testing-library/react'
import { SKIP_SCROLL_INTO_VIEW_TAG } from 'lexical'
import { useEffect } from 'react'
import { beforeAll, describe, expect, it } from 'vitest'
import { ComposerAutoFocusPlugin } from '../plugins/ComposerAutoFocusPlugin'

/** Lexical tags the update `editor.focus()` commits; the package does not export the constant. */
const LEXICAL_FOCUS_TAG = 'focus'

function UpdateTagProbe({ onUpdateTags }: { readonly onUpdateTags: (tags: string[]) => void }) {
  const [editor] = useLexicalComposerContext()
  useEffect(
    () => editor.registerUpdateListener(({ tags }) => onUpdateTags([...tags])),
    [editor, onUpdateTags],
  )
  return null
}

function Editor({ onUpdateTags }: { readonly onUpdateTags?: (tags: string[]) => void }) {
  return (
    <LexicalComposer
      initialConfig={{
        namespace: 'focus-test',
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
      {onUpdateTags ? <UpdateTagProbe onUpdateTags={onUpdateTags} /> : null}
      <ComposerAutoFocusPlugin />
    </LexicalComposer>
  )
}

describe('ComposerAutoFocusPlugin', () => {
  beforeAll(() => {
    Range.prototype.getBoundingClientRect = () => new DOMRect()
  })

  it('focuses the composer when it mounts with nothing else focused', async () => {
    render(<Editor />)

    await waitFor(() => expect(screen.getByLabelText('Message input')).toHaveFocus())
  })

  it('leaves focus in a text field the person is already typing in', async () => {
    const field = document.createElement('input')
    field.setAttribute('aria-label', 'Session title')
    document.body.append(field)
    field.focus()

    render(<Editor />)
    await new Promise((resolve) => setTimeout(resolve, 50))

    expect(field).toHaveFocus()
    field.remove()
  })

  it('still takes focus from a button', async () => {
    const button = document.createElement('button')
    document.body.append(button)
    button.focus()

    render(<Editor />)

    await waitFor(() => expect(screen.getByLabelText('Message input')).toHaveFocus())
    button.remove()
  })

  it('skips the caret scroll check in the update that focuses the mounted composer', async () => {
    const updateTags: string[][] = []

    render(<Editor onUpdateTags={(tags) => updateTags.push(tags)} />)
    await waitFor(() => expect(screen.getByLabelText('Message input')).toHaveFocus())

    // Lexical's scroll check reads every ancestor's box and forced a layout of the fresh shell.
    const focusUpdate = updateTags.find((tags) => tags.includes(LEXICAL_FOCUS_TAG))
    expect(focusUpdate).toContain(SKIP_SCROLL_INTO_VIEW_TAG)
  })
})
