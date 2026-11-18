import { describe, expect, it } from 'vitest'
import { buildSessionTitlePrompt } from '../session-title-prompts'
import { limitTitleMessage } from '../session-title-text'

describe('buildSessionTitlePrompt', () => {
  it('asks for a first title in the user language from the first message', () => {
    const prompt = buildSessionTitlePrompt({
      message: 'Necesito títulos cortos para las sesiones',
      attachments: [{ id: 'a', name: 'sidebar.png', mimeType: 'image/png' }],
    })

    expect(prompt.systemPrompt).toContain('OpenWaggle session')
    expect(prompt.systemPrompt).toContain('same language')
    expect(prompt.systemPrompt).toContain('needsRefinement')
    expect(prompt.prompt).toBe(
      'User message:\nNecesito títulos cortos para las sesiones\n\nAttachment metadata:\n- sidebar.png (image/png)',
    )
  })

  it('regenerates against the previous title from the session contents', () => {
    const prompt = buildSessionTitlePrompt({
      message: 'USER:\nFix this\n\nASSISTANT:\nFound it',
      previousTitle: 'Fix failing test',
    })

    expect(prompt.systemPrompt).toContain('The previous title was "Fix failing test".')
    expect(prompt.prompt).toBe('Session contents:\nUSER:\nFix this\n\nASSISTANT:\nFound it')
  })

  it('keeps the end of an oversized history when regenerating', () => {
    const prompt = buildSessionTitlePrompt({
      message: `${'a'.repeat(9_000)}END`,
      previousTitle: 'Old',
    })

    expect(prompt.prompt.endsWith('END')).toBe(true)
    expect(prompt.prompt).toContain('[Earlier content truncated]')
  })
})

describe('limitTitleMessage', () => {
  it('keeps the start and end of a long request', () => {
    const limited = limitTitleMessage(`start ${'x'.repeat(500)} end`, 100)

    expect(limited.length).toBeLessThanOrEqual(100)
    expect(limited.startsWith('start')).toBe(true)
    expect(limited.endsWith('end')).toBe(true)
    expect(limited).toContain('[Content truncated]')
  })

  it('returns short requests unchanged', () => {
    expect(limitTitleMessage('short', 100)).toBe('short')
  })
})
