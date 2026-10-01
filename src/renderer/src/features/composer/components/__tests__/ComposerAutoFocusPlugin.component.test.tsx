import { LexicalComposer } from '@lexical/react/LexicalComposer'
import { ContentEditable } from '@lexical/react/LexicalContentEditable'
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary'
import { PlainTextPlugin } from '@lexical/react/LexicalPlainTextPlugin'
import { render, screen, waitFor } from '@testing-library/react'
import { beforeAll, describe, expect, it } from 'vitest'
import { ComposerAutoFocusPlugin } from '../plugins/ComposerAutoFocusPlugin'

function Editor() {
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
})
