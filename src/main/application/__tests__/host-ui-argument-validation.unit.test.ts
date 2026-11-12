import { SupportedModelId } from '@shared/types/brand'
import * as Effect from 'effect/Effect'
import { describe, expect, it } from 'vitest'
import {
  hostUiStringValue,
  optionalHostUiProjectPath,
  optionalHostUiProviderCatalogScope,
  requiredHostUiString,
} from '../host-ui-operation-validation'
import {
  requiredString,
  validateOptionalModel,
  validateOptionalThinkingLevel,
  validateThinkingLevel,
} from '../host-ui-session-operation-validation'

/**
 * Scalar Host UI arguments are decoded with the schemas in `host-ui-argument-schemas`; each
 * refusal is the one message that names the argument, whatever part of the schema failed.
 */

function refusal(effect: Effect.Effect<unknown, Error>) {
  return Effect.runPromise(Effect.flip(effect)).then((error) => error.message)
}

describe('Host UI scalar argument decoding', () => {
  it.each([
    ['a number', 42, 'Run ID must be a non-empty string.'],
    ['a blank string', '  ', 'Run ID must be a non-empty string.'],
    ['an over-long string', 'r'.repeat(5000), 'Run ID exceeds the input limit.'],
  ])('refuses a Session operation string that is %s', async (_case, value, message) => {
    await expect(refusal(requiredString(value, 'Run ID'))).resolves.toBe(message)
  })

  it('decodes a canonical model reference into a branded model id', async () => {
    await expect(Effect.runPromise(validateOptionalModel('openai/gpt-5'))).resolves.toBe(
      SupportedModelId('openai/gpt-5'),
    )
    await expect(Effect.runPromise(validateOptionalModel(undefined))).resolves.toBeUndefined()
  })

  it.each([
    ['a number', 7, 'Session model must be a non-empty string.'],
    ['not provider/model', 'gpt-5', 'Session model must be a canonical provider/model reference.'],
  ])('refuses a Session model that is %s', async (_case, value, message) => {
    await expect(refusal(validateOptionalModel(value))).resolves.toBe(message)
  })

  it('refuses an unknown thinking level with the one message that lists the levels', async () => {
    const message = await refusal(validateThinkingLevel('extreme'))

    expect(message).toMatch(/^Thinking level must be one of off, .+\.$/)
    await expect(refusal(validateOptionalThinkingLevel(3))).resolves.toBe(message)
    await expect(Effect.runPromise(validateOptionalThinkingLevel('high'))).resolves.toBe('high')
  })

  it('keeps the general Host UI argument messages', async () => {
    await expect(refusal(requiredHostUiString(' ', 'Branch'))).resolves.toBe(
      'Branch must be a non-empty string.',
    )
    await expect(refusal(hostUiStringValue(1, 'Query'))).resolves.toBe('Query must be a string.')
    await expect(refusal(optionalHostUiProjectPath(1))).resolves.toBe(
      'Project path must be a string, null, or omitted.',
    )
    await expect(Effect.runPromise(optionalHostUiProjectPath(null))).resolves.toBeNull()
    await expect(refusal(optionalHostUiProviderCatalogScope('some'))).resolves.toBe(
      'Provider catalog scope must be one of available, all.',
    )
  })
})
