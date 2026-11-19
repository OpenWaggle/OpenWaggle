import { safeDecodeUnknown } from '@shared/schema'
import { describe, expect, it } from 'vitest'
import { projectSettingsFileSchema } from '../validation'

function decodes(value: unknown) {
  const result = safeDecodeUnknown(projectSettingsFileSchema, value)
  return result.success
}

describe('project settings file providers scope', () => {
  it('accepts a per-provider boolean choice', () => {
    expect(decodes({ providers: { 'amazon-bedrock': false } })).toBe(true)
  })

  it('accepts the reserved only list', () => {
    expect(decodes({ providers: { only: ['amazon-bedrock'] } })).toBe(true)
  })

  it('rejects a scope entry that is neither a boolean nor the only list', () => {
    expect(decodes({ providers: { 'amazon-bedrock': 'nope' } })).toBe(false)
    expect(decodes({ providers: { openrouter: 1 } })).toBe(false)
    expect(decodes({ providers: 'openrouter' })).toBe(false)
  })
})
