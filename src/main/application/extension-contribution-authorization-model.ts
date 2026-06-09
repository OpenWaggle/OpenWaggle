import { match } from '@diegogbrisa/ts-match'
import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import type {
  ExtensionCapabilityDeclaration,
  ExtensionContributionRegistration,
  OpenWaggleExtensionManifest,
} from '@shared/schemas/extensions'
import type { ExtensionContributionFamily } from '@shared/types/extensions'
import type { DiscoveredExtensionPackage, ExtensionDiagnostic } from '../extensions/types'
import {
  getManifestFamilyContributions,
  type ManifestContribution,
} from './extension-contribution-family-model'

const DEFAULT_DECLARED_SCOPES = ['app'] as const

interface ContributionBrokerBinding {
  readonly method?: string
  readonly methods?: readonly string[]
}

type ContributionCapabilityBinding =
  | {
      readonly _tag: 'unbound'
      readonly methods: readonly string[]
    }
  | {
      readonly _tag: 'bound'
      readonly capability: string
      readonly methods: readonly string[]
    }

export type ContributionRegistrationAuthorization =
  | {
      readonly _tag: 'authorized'
    }
  | {
      readonly _tag: 'rejected'
      readonly diagnostics: readonly ExtensionDiagnostic[]
    }

function uniqueMethods(binding: ContributionBrokerBinding) {
  const methods: string[] = []
  if (binding.method !== undefined) {
    methods.push(binding.method)
  }
  for (const method of binding.methods ?? []) {
    if (!methods.includes(method)) {
      methods.push(method)
    }
  }
  return methods
}

function contributionCapabilityBinding(
  contribution: ManifestContribution,
): ContributionCapabilityBinding {
  const methods = uniqueMethods(contribution)
  return contribution.capability === undefined
    ? { _tag: 'unbound', methods }
    : { _tag: 'bound', capability: contribution.capability, methods }
}

function contributionDiagnostic(input: {
  readonly extensionPackage: DiscoveredExtensionPackage
  readonly family: ExtensionContributionFamily
  readonly contributionId?: string
  readonly message: string
  readonly index?: number
}): ExtensionDiagnostic {
  const suffix =
    input.index === undefined
      ? `contributions.${input.family}`
      : `contributions.${input.family}.${input.index}`
  const contributionLabel =
    input.contributionId === undefined ? '' : ` Contribution "${input.contributionId}".`

  return {
    severity: OPENWAGGLE_EXTENSION.DIAGNOSTIC.SEVERITY.ERROR,
    code: OPENWAGGLE_EXTENSION.DIAGNOSTIC.CODE.CONTRIBUTION_REGISTRATION_FAILED,
    message: `${input.message}${contributionLabel}`,
    path: `${input.extensionPackage.manifestPath}#${suffix}`,
  }
}

export function findManifestCapabilityDeclaration(input: {
  readonly manifest: OpenWaggleExtensionManifest | null
  readonly capability: string
}) {
  return (
    input.manifest?.capabilities?.find((capability) => capability.id === input.capability) ?? null
  )
}

export function getDeclaredScopes(
  declaration: ExtensionCapabilityDeclaration,
): readonly (typeof OPENWAGGLE_EXTENSION.CAPABILITY_SCOPES)[number][] {
  return declaration.scopes ?? DEFAULT_DECLARED_SCOPES
}

export function methodIsDeclared(declaration: ExtensionCapabilityDeclaration, method: string) {
  return declaration.methods?.includes(method) === true
}

export function contributionMethodIsDeclared(binding: ContributionBrokerBinding, method: string) {
  return binding.method === method || binding.methods?.includes(method) === true
}

export function manifestDeclaresContributionFamily(input: {
  readonly manifest: OpenWaggleExtensionManifest | null
  readonly family: ExtensionContributionFamily
}) {
  if (!input.manifest?.contributions) {
    return false
  }

  return getManifestFamilyContributions(input.manifest.contributions, input.family) !== undefined
}

function familyDiagnostics(input: {
  readonly extensionPackage: DiscoveredExtensionPackage
  readonly family: ExtensionContributionFamily
  readonly contributionId?: string
  readonly index?: number
}) {
  if (input.extensionPackage.manifest === null) {
    return [
      contributionDiagnostic({
        ...input,
        message: 'Contribution registration requires a valid extension manifest.',
      }),
    ]
  }

  if (
    manifestDeclaresContributionFamily({
      manifest: input.extensionPackage.manifest,
      family: input.family,
    })
  ) {
    return []
  }

  return [
    contributionDiagnostic({
      ...input,
      message: `Dynamic registration for contribution family "${input.family}" is not declared in the extension manifest.`,
    }),
  ]
}

function undeclaredMethodDiagnostics(input: {
  readonly extensionPackage: DiscoveredExtensionPackage
  readonly family: ExtensionContributionFamily
  readonly contributionId: string
  readonly index?: number
  readonly capability: string
  readonly declaration: ExtensionCapabilityDeclaration
  readonly methods: readonly string[]
}) {
  return input.methods
    .filter((method) => !methodIsDeclared(input.declaration, method))
    .map((method) =>
      contributionDiagnostic({
        extensionPackage: input.extensionPackage,
        family: input.family,
        contributionId: input.contributionId,
        index: input.index,
        message: `Contribution requests method "${method}" for capability "${input.capability}", but the manifest capability does not declare that method.`,
      }),
    )
}

function capabilityDiagnostics(input: {
  readonly extensionPackage: DiscoveredExtensionPackage
  readonly family: ExtensionContributionFamily
  readonly contribution: ManifestContribution
  readonly index?: number
}) {
  const binding = contributionCapabilityBinding(input.contribution)

  return match(binding)
    .with({ _tag: 'unbound' }, () => [])
    .with({ _tag: 'bound' }, (bound) => {
      const declaration = findManifestCapabilityDeclaration({
        manifest: input.extensionPackage.manifest,
        capability: bound.capability,
      })
      if (declaration === null) {
        return [
          contributionDiagnostic({
            extensionPackage: input.extensionPackage,
            family: input.family,
            contributionId: input.contribution.id,
            index: input.index,
            message: `Contribution requests capability "${bound.capability}", but the manifest does not declare that capability.`,
          }),
        ]
      }

      return undeclaredMethodDiagnostics({
        extensionPackage: input.extensionPackage,
        family: input.family,
        contributionId: input.contribution.id,
        index: input.index,
        capability: bound.capability,
        declaration,
        methods: bound.methods,
      })
    })
    .exhaustive()
}

export function authorizeContributionRegistration(input: {
  readonly extensionPackage: DiscoveredExtensionPackage
  readonly family: ExtensionContributionFamily
  readonly contribution: ManifestContribution
  readonly index?: number
}): ContributionRegistrationAuthorization {
  const diagnostics = [
    ...familyDiagnostics({
      extensionPackage: input.extensionPackage,
      family: input.family,
      contributionId: input.contribution.id,
      index: input.index,
    }),
    ...capabilityDiagnostics(input),
  ]

  return diagnostics.length === 0 ? { _tag: 'authorized' } : { _tag: 'rejected', diagnostics }
}

export function authorizeRuntimeContributionRegistration(input: {
  readonly extensionPackage: DiscoveredExtensionPackage
  readonly registration: ExtensionContributionRegistration
}): ContributionRegistrationAuthorization {
  return authorizeContributionRegistration({
    extensionPackage: input.extensionPackage,
    family: input.registration.family,
    contribution: input.registration.contribution,
  })
}
