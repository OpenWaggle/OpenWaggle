import dns from 'node:dns'
import {
  callablePatch,
  constructablePatch,
  type TrustedMainNetworkEscapeGuard,
  type TrustedMainNetworkEscapePatchInstaller,
} from './trusted-main-network-escape-guard-model'

const DNS_REASON = 'Direct DNS resolution can bypass declared network origins.'

const DNS_PATCH_INSTALLERS = [
  constructablePatch({
    target: dns,
    propertyName: 'Resolver',
    original: dns.Resolver,
    api: 'node:dns.Resolver',
    reason: DNS_REASON,
  }),
  callablePatch({
    target: dns,
    propertyName: 'lookup',
    original: dns.lookup,
    api: 'node:dns.lookup',
    reason: DNS_REASON,
  }),
  callablePatch({
    target: dns,
    propertyName: 'lookupService',
    original: dns.lookupService,
    api: 'node:dns.lookupService',
    reason: DNS_REASON,
  }),
  callablePatch({
    target: dns,
    propertyName: 'resolve',
    original: dns.resolve,
    api: 'node:dns.resolve',
    reason: DNS_REASON,
  }),
  callablePatch({
    target: dns,
    propertyName: 'resolve4',
    original: dns.resolve4,
    api: 'node:dns.resolve4',
    reason: DNS_REASON,
  }),
  callablePatch({
    target: dns,
    propertyName: 'resolve6',
    original: dns.resolve6,
    api: 'node:dns.resolve6',
    reason: DNS_REASON,
  }),
  callablePatch({
    target: dns,
    propertyName: 'resolveAny',
    original: dns.resolveAny,
    api: 'node:dns.resolveAny',
    reason: DNS_REASON,
  }),
  callablePatch({
    target: dns,
    propertyName: 'resolveCaa',
    original: dns.resolveCaa,
    api: 'node:dns.resolveCaa',
    reason: DNS_REASON,
  }),
  callablePatch({
    target: dns,
    propertyName: 'resolveCname',
    original: dns.resolveCname,
    api: 'node:dns.resolveCname',
    reason: DNS_REASON,
  }),
  callablePatch({
    target: dns,
    propertyName: 'resolveMx',
    original: dns.resolveMx,
    api: 'node:dns.resolveMx',
    reason: DNS_REASON,
  }),
  callablePatch({
    target: dns,
    propertyName: 'resolveNaptr',
    original: dns.resolveNaptr,
    api: 'node:dns.resolveNaptr',
    reason: DNS_REASON,
  }),
  callablePatch({
    target: dns,
    propertyName: 'resolveNs',
    original: dns.resolveNs,
    api: 'node:dns.resolveNs',
    reason: DNS_REASON,
  }),
  callablePatch({
    target: dns,
    propertyName: 'resolvePtr',
    original: dns.resolvePtr,
    api: 'node:dns.resolvePtr',
    reason: DNS_REASON,
  }),
  callablePatch({
    target: dns,
    propertyName: 'resolveSoa',
    original: dns.resolveSoa,
    api: 'node:dns.resolveSoa',
    reason: DNS_REASON,
  }),
  callablePatch({
    target: dns,
    propertyName: 'resolveSrv',
    original: dns.resolveSrv,
    api: 'node:dns.resolveSrv',
    reason: DNS_REASON,
  }),
  callablePatch({
    target: dns,
    propertyName: 'resolveTxt',
    original: dns.resolveTxt,
    api: 'node:dns.resolveTxt',
    reason: DNS_REASON,
  }),
  callablePatch({
    target: dns,
    propertyName: 'reverse',
    original: dns.reverse,
    api: 'node:dns.reverse',
    reason: DNS_REASON,
  }),
  constructablePatch({
    target: dns.promises,
    propertyName: 'Resolver',
    original: dns.promises.Resolver,
    api: 'node:dns/promises.Resolver',
    reason: DNS_REASON,
  }),
  callablePatch({
    target: dns.promises,
    propertyName: 'lookup',
    original: dns.promises.lookup,
    api: 'node:dns/promises.lookup',
    reason: DNS_REASON,
  }),
  callablePatch({
    target: dns.promises,
    propertyName: 'lookupService',
    original: dns.promises.lookupService,
    api: 'node:dns/promises.lookupService',
    reason: DNS_REASON,
  }),
  callablePatch({
    target: dns.promises,
    propertyName: 'resolve',
    original: dns.promises.resolve,
    api: 'node:dns/promises.resolve',
    reason: DNS_REASON,
  }),
  callablePatch({
    target: dns.promises,
    propertyName: 'resolve4',
    original: dns.promises.resolve4,
    api: 'node:dns/promises.resolve4',
    reason: DNS_REASON,
  }),
  callablePatch({
    target: dns.promises,
    propertyName: 'resolve6',
    original: dns.promises.resolve6,
    api: 'node:dns/promises.resolve6',
    reason: DNS_REASON,
  }),
  callablePatch({
    target: dns.promises,
    propertyName: 'resolveAny',
    original: dns.promises.resolveAny,
    api: 'node:dns/promises.resolveAny',
    reason: DNS_REASON,
  }),
  callablePatch({
    target: dns.promises,
    propertyName: 'reverse',
    original: dns.promises.reverse,
    api: 'node:dns/promises.reverse',
    reason: DNS_REASON,
  }),
] satisfies readonly TrustedMainNetworkEscapePatchInstaller[]

export function installTrustedMainDnsNetworkEscapeGuard(input: TrustedMainNetworkEscapeGuard) {
  for (const installPatch of DNS_PATCH_INSTALLERS) {
    installPatch(input)
  }
}
