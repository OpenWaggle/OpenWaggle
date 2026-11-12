import dns from 'node:dns'
import {
  callablePatch,
  constructablePatch,
  type TrustedMainNetworkEscapeGuard,
  type TrustedMainNetworkEscapePatchInstaller,
} from './trusted-main-network-escape-guard-model'

const DNS_REASON = 'Direct DNS resolution can bypass declared network origins.'
const LOOKUP_FUNCTIONS = ['lookup'] as const
const RESOLVE_FUNCTIONS = [
  'lookupService',
  'resolve',
  'resolve4',
  'resolve6',
  'resolveAny',
  'resolveCaa',
  'resolveCname',
  'resolveMx',
  'resolveNaptr',
  'resolveNs',
  'resolvePtr',
  'resolveSoa',
  'resolveSrv',
  'resolveTxt',
  'reverse',
] as const

type Callable = (...args: readonly unknown[]) => unknown

function isCallable(value: unknown): value is Callable {
  return typeof value === 'function'
}

function functionPatches(input: {
  readonly target: object
  readonly apiPrefix: string
  readonly names: readonly string[]
  readonly allowsAuthorizedHostname: boolean
}): TrustedMainNetworkEscapePatchInstaller[] {
  return input.names.flatMap((propertyName) => {
    const original: unknown = Reflect.get(input.target, propertyName)
    if (!isCallable(original)) {
      return []
    }
    return [
      callablePatch({
        target: input.target,
        propertyName,
        original,
        api: `${input.apiPrefix}.${propertyName}`,
        reason: DNS_REASON,
        allowsAuthorizedHostname: input.allowsAuthorizedHostname,
      }),
    ]
  })
}

/**
 * The module functions (`dns.lookup`, `dns/promises.resolve4`, ...) and the `Resolver` prototype
 * methods. Node also resolves named imports through the patched module objects; Bun's named
 * imports keep the original functions, which reach `Bun.dns` (guarded in the Bun guard) or a
 * `Resolver` instance, whose prototype methods are patched here.
 */
function dnsTargetPatches(input: {
  readonly module: object
  readonly resolverPrototype: object
  readonly apiPrefix: string
}) {
  return [
    ...functionPatches({
      target: input.module,
      apiPrefix: input.apiPrefix,
      names: LOOKUP_FUNCTIONS,
      allowsAuthorizedHostname: true,
    }),
    ...functionPatches({
      target: input.module,
      apiPrefix: input.apiPrefix,
      names: RESOLVE_FUNCTIONS,
      allowsAuthorizedHostname: false,
    }),
    ...functionPatches({
      target: input.resolverPrototype,
      apiPrefix: `${input.apiPrefix}.Resolver`,
      names: RESOLVE_FUNCTIONS,
      allowsAuthorizedHostname: false,
    }),
  ]
}

function dnsPatches(): TrustedMainNetworkEscapePatchInstaller[] {
  return [
    constructablePatch({
      target: dns,
      propertyName: 'Resolver',
      original: dns.Resolver,
      api: 'node:dns.Resolver',
      reason: DNS_REASON,
    }),
    constructablePatch({
      target: dns.promises,
      propertyName: 'Resolver',
      original: dns.promises.Resolver,
      api: 'node:dns/promises.Resolver',
      reason: DNS_REASON,
    }),
    ...dnsTargetPatches({
      module: dns,
      resolverPrototype: dns.Resolver.prototype,
      apiPrefix: 'node:dns',
    }),
    ...dnsTargetPatches({
      module: dns.promises,
      resolverPrototype: dns.promises.Resolver.prototype,
      apiPrefix: 'node:dns/promises',
    }),
  ]
}

export function installTrustedMainDnsNetworkEscapeGuard(input: TrustedMainNetworkEscapeGuard) {
  for (const installPatch of dnsPatches()) {
    installPatch(input)
  }
}
