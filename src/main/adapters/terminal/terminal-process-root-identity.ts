import type { TerminalProcessIdentity } from './terminal-process-identity'
import type { ProcessRow } from './terminal-process-probes'

export function terminalRootIdentityProof(
  root: ProcessRow | undefined,
  cachedRoot: TerminalProcessIdentity | undefined,
  ttyClosed: boolean,
  ttyIdentity: string | null,
) {
  const rootIdentityVerified =
    root?.identityVerified === true &&
    cachedRoot !== undefined &&
    !ttyClosed &&
    ttyIdentity !== null &&
    root.startedAt === cachedRoot.startedAt &&
    root.ttyIdentity === ttyIdentity
  const rootIdentityMismatch =
    root?.identityVerified === true &&
    cachedRoot !== undefined &&
    root.startedAt !== cachedRoot.startedAt
  const rootExitedByIdentity =
    cachedRoot !== undefined &&
    (root === undefined || rootIdentityMismatch || (root.identityVerified && root.zombie))
  return { rootIdentityVerified, rootIdentityMismatch, rootExitedByIdentity }
}

export function matchesCachedProcessIdentity(
  row: ProcessRow | undefined,
  identity: TerminalProcessIdentity,
) {
  return row?.identityVerified === true && row.startedAt === identity.startedAt
}
