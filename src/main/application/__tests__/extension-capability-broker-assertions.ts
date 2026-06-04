import { OPENWAGGLE_EXTENSION_BROKER } from '@shared/constants/extension-broker'
import type {
  ExtensionInvokeFailureCode,
  ExtensionInvokeResult,
} from '@shared/types/extension-broker'
import { expect } from 'vitest'

export function expectBrokerFailure(
  result: ExtensionInvokeResult,
  code: ExtensionInvokeFailureCode,
  timestamp: number,
) {
  if (result.ok) {
    throw new Error('Expected broker invocation to fail.')
  }

  expect(result.error.code).toBe(code)
  expect(result.audit?.failureCode).toBe(code)
  expect(result.audit?.outcome).toBe(OPENWAGGLE_EXTENSION_BROKER.OUTCOME.REJECTED)
  expect(result.audit?.timestamp).toBe(timestamp)
}

export function makeExpectBrokerFailure(timestamp: number) {
  return (result: ExtensionInvokeResult, code: ExtensionInvokeFailureCode) =>
    expectBrokerFailure(result, code, timestamp)
}
