import type { ActionCatalog, PreparationDefinition } from '@shared/types/action-definitions'
import { fromPartial } from '@total-typescript/shoehorn'
import { describe, expect, it } from 'vitest'
import { preparationSavedMessage } from '../action-panel-copy'

const setup: PreparationDefinition = {
  id: 'install',
  profileId: 'default',
  phase: 'setup',
  invocation: { type: 'command', command: 'pnpm install', directory: '.' },
}

function savedWith(review: ActionCatalog['preparation'][number]['review']) {
  return fromPartial<ActionCatalog>({ preparation: [{ definition: setup, review }] })
}

describe('preparationSavedMessage', () => {
  it('says the setup is on when the save counted as the saver’s review', () => {
    expect(preparationSavedMessage(savedWith('enabled'), setup)).toBe(
      'Saved your worktree setup. It’s on for you.',
    )
  })

  it('says it stays off when an unchanged pending change was saved (ADR 0038)', () => {
    expect(preparationSavedMessage(savedWith('required'), setup)).toBe(
      'Saved your worktree setup. It stays off until you check it in Settings.',
    )
  })
})
