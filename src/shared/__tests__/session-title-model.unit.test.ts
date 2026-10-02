import { describe, expect, it } from 'vitest'
import {
  isSessionTitleGenerationEnabled,
  parseSessionTitleModelSetting,
  SESSION_TITLE_MODEL_AUTOMATIC,
  SESSION_TITLE_MODEL_OFF,
} from '../session-title-model'

describe('parseSessionTitleModelSetting', () => {
  it('accepts Automatic, Off, and a provider/model reference', () => {
    expect(parseSessionTitleModelSetting(' automatic ')).toBe(SESSION_TITLE_MODEL_AUTOMATIC)
    expect(parseSessionTitleModelSetting('off')).toBe(SESSION_TITLE_MODEL_OFF)
    expect(parseSessionTitleModelSetting('anthropic/claude-haiku')).toBe('anthropic/claude-haiku')
  })

  it('rejects anything else', () => {
    expect(parseSessionTitleModelSetting('claude-haiku')).toBeNull()
    expect(parseSessionTitleModelSetting('')).toBeNull()
    expect(parseSessionTitleModelSetting(42)).toBeNull()
  })

  it('treats only Off as disabled', () => {
    expect(isSessionTitleGenerationEnabled(SESSION_TITLE_MODEL_OFF)).toBe(false)
    expect(isSessionTitleGenerationEnabled(SESSION_TITLE_MODEL_AUTOMATIC)).toBe(true)
  })
})
