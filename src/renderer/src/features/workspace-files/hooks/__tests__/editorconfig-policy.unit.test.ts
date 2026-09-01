import { describe, expect, it } from 'vitest'
import { applyEditorConfigContentPolicy } from '../../lib/editorconfig-policy'

describe('applyEditorConfigContentPolicy', () => {
  it('trims line endings and inserts one final newline when the standard policy enables them', () => {
    expect(
      applyEditorConfigContentPolicy('const a = 1  \nconst b = 2\t', {
        trimTrailingWhitespace: true,
        finalNewline: true,
      }),
    ).toBe('const a = 1\nconst b = 2\n')
  })

  it('preserves content when those policies are absent or disabled', () => {
    expect(
      applyEditorConfigContentPolicy('const a = 1  ', {
        trimTrailingWhitespace: false,
        finalNewline: false,
      }),
    ).toBe('const a = 1  ')
  })
})
