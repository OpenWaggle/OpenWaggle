import { decodeUnknownExactOrThrow } from '@shared/schema'
import { delegationScopeClaimSchema } from '@shared/schemas/session-collaboration-control'
import { delegationSpecificationSchema } from '@shared/schemas/session-lifecycle'
import type { ParsedArguments } from './mcp-cli-arguments'

export function delegationEvidence(arguments_: ParsedArguments) {
  return (arguments_.options.get('evidence-json') ?? []).map((value) => {
    const parsed: unknown = JSON.parse(value)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new Error('--evidence-json must contain one JSON object.')
    }
    const record = Object.fromEntries(Object.entries(parsed))
    const kinds = [
      'observed-command',
      'workspace-diff',
      'artifact',
      'source-reference',
      'asserted-note',
    ] as const
    const kind = kinds.find((candidate) => candidate === record.kind)
    if (!kind || typeof record.summary !== 'string') {
      throw new Error('--evidence-json requires a supported kind and string summary.')
    }
    return {
      kind,
      summary: record.summary,
      ...(typeof record.reference === 'string' ? { reference: record.reference } : {}),
    }
  })
}

export function delegationClaims(arguments_: ParsedArguments) {
  return (arguments_.options.get('claim-json') ?? []).map((value) =>
    decodeUnknownExactOrThrow(delegationScopeClaimSchema, JSON.parse(value)),
  )
}

export function delegationSpecification(arguments_: ParsedArguments) {
  const values = arguments_.options.get('specification-json') ?? []
  if (values.length !== 1 || !values[0]) {
    throw new Error('Delegation amendment requires exactly one --specification-json object.')
  }
  return decodeUnknownExactOrThrow(delegationSpecificationSchema, JSON.parse(values[0]))
}
