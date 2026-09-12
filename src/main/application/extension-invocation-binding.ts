import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { OPENWAGGLE_EXTENSION_BROKER } from '@shared/constants/extension-broker'
import type { ExtensionInvokeInput } from '@shared/types/extension-broker'
import type { ExtensionContributionRegistryEntry } from '@shared/types/extensions'

const BINDING_SECRET = randomBytes(32)
const BINDING_ALGORITHM = 'sha256'

type ExtensionInvocationBindingIdentity = Pick<
  ExtensionContributionRegistryEntry,
  | 'extensionId'
  | 'contributionId'
  | 'family'
  | 'packagePath'
  | 'contentHash'
  | 'projectPaths'
  | 'sessionId'
>

function bindingPayload(input: ExtensionInvocationBindingIdentity) {
  return JSON.stringify({
    extensionId: input.extensionId,
    contributionId: input.contributionId,
    family: input.family,
    packagePath: input.packagePath,
    contentHash: input.contentHash,
    projectPaths: [...input.projectPaths].sort(),
    sessionId: input.sessionId ?? null,
  })
}

export function issueExtensionInvocationBinding(input: ExtensionInvocationBindingIdentity) {
  return createHmac(BINDING_ALGORITHM, BINDING_SECRET).update(bindingPayload(input)).digest('hex')
}

export function matchesExtensionInvocationBinding(
  entry: ExtensionContributionRegistryEntry,
  candidate: string | undefined,
) {
  if (!candidate) return false
  const expected = Buffer.from(issueExtensionInvocationBinding(entry))
  const actual = Buffer.from(candidate)
  return expected.length === actual.length && timingSafeEqual(expected, actual)
}

export function invocationHasMountedSessionBinding(
  entry: ExtensionContributionRegistryEntry | null,
  invocation: ExtensionInvokeInput,
  invocationBinding: string | undefined,
) {
  if (invocation.capability !== OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.RESOURCES) {
    return true
  }
  if (
    !entry ||
    invocation.scope.kind !== 'session' ||
    entry.sessionId !== invocation.scope.sessionId
  ) {
    return false
  }
  return matchesExtensionInvocationBinding(entry, invocationBinding)
}
