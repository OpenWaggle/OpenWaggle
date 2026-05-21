import { beforeEach, describe, expect, it } from 'vitest'
import { useComposerStore } from '@/features/composer/state'
import { setComposerTextValue } from '../composer-text'

describe('composer text synchronization', () => {
  beforeEach(() => {
    useComposerStore.setState({ input: '', lexicalEditor: null, cursorIndex: 0 })
  })

  it('updates plain composer state when no Lexical editor is mounted', () => {
    setComposerTextValue('draft text')

    const state = useComposerStore.getState()
    expect(state.input).toBe('draft text')
    expect(state.lexicalEditor).toBeNull()
  })
})
