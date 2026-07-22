import { OPENWAGGLE_EXTENSION_BROKER } from '@shared/constants/extension-broker'
import type { ExtensionInvokeInput } from '@shared/types/extension-broker'
import * as Effect from 'effect/Effect'
import { validateRequiredProjectPath } from '../utils/project-path-validation'
import { auditedFailure } from './extension-capability-broker-audit'

export interface BrokerRouteInput {
  readonly invocation: ExtensionInvokeInput
  readonly timestamp: number
}

type ProjectPathValidationResult =
  | { readonly _tag: 'valid'; readonly projectPath: string }
  | { readonly _tag: 'invalid'; readonly message: string }

export function invalidPayload(input: BrokerRouteInput & { readonly issues?: readonly string[] }) {
  return auditedFailure({
    invocation: input.invocation,
    code: OPENWAGGLE_EXTENSION_BROKER.FAILURE_CODE.INVALID_PAYLOAD,
    message: `Invalid payload for ${input.invocation.capability}.${input.invocation.method}.`,
    ...(input.issues !== undefined ? { issues: input.issues } : {}),
    timestamp: input.timestamp,
  })
}

export function unsupportedMethod(input: BrokerRouteInput) {
  return auditedFailure({
    invocation: input.invocation,
    code: OPENWAGGLE_EXTENSION_BROKER.FAILURE_CODE.UNSUPPORTED_METHOD,
    message: `Method "${input.invocation.method}" is not implemented for capability "${input.invocation.capability}".`,
    timestamp: input.timestamp,
  })
}

export function payloadDecodeFailure(input: BrokerRouteInput, issues: readonly string[]) {
  return invalidPayload({ ...input, issues })
}

export function validateBrokerProjectPath(
  projectPath: string,
): Effect.Effect<ProjectPathValidationResult> {
  return validateRequiredProjectPath(projectPath).pipe(
    Effect.map(
      (validatedProjectPath): ProjectPathValidationResult => ({
        _tag: 'valid',
        projectPath: validatedProjectPath,
      }),
    ),
    Effect.catchAll((error) =>
      Effect.succeed<ProjectPathValidationResult>({
        _tag: 'invalid',
        message: error.message,
      }),
    ),
  )
}
