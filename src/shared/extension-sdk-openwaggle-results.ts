import { type SafeDecodeFailure, type SafeDecodeSuccess, safeDecodeUnknown } from '@shared/schema'
import type { ExtensionInvokeFailure, ExtensionInvokeResult } from '@shared/types/extension-broker'
import type * as EffectSchema from 'effect/Schema'
import type { ExtensionOperationSuccess } from './extension-sdk-core'
import { invalidOperationResult } from './extension-sdk-core'

export type SuccessfulInvokeResult = ExtensionInvokeResult & { readonly ok: true }
export type DecodeResult<TValue> = SafeDecodeSuccess<TValue> | SafeDecodeFailure

export function openWaggleResultError(message: string) {
  return (input: {
    readonly result: SuccessfulInvokeResult
    readonly issues: readonly string[]
  }): ExtensionInvokeFailure =>
    invalidOperationResult({ audit: input.result.audit, issues: input.issues, message })
}

export function toDecodedOperationResult<TValue>(
  result: ExtensionInvokeResult,
  decode: (value: unknown) => DecodeResult<TValue>,
  invalidResult: (input: {
    readonly result: SuccessfulInvokeResult
    readonly issues: readonly string[]
  }) => ExtensionInvokeFailure,
): ExtensionOperationSuccess<TValue> | ExtensionInvokeFailure {
  if (!result.ok) {
    return result
  }

  const decoded = decode(result.value)
  return decoded.success
    ? { ok: true, value: decoded.data, audit: result.audit }
    : invalidResult({ result, issues: decoded.issues })
}

export function decodeWithSchema<TValue, TEncoded>(
  schema: EffectSchema.Schema<TValue, TEncoded, never>,
) {
  return (value: unknown) => safeDecodeUnknown(schema, value)
}
