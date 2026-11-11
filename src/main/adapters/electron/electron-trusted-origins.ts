import { protocol } from 'electron'
import type { TrustedOriginsShape } from '../../ports/desktop-shell/trusted-origins'
import { TRUSTED_ORIGIN_SCHEMES } from '../../trusted-origin-schemes'

/** Electron serves each trusted origin domain as a privileged custom scheme. */
export const electronTrustedOrigins: TrustedOriginsShape = {
  declare: (declarations) =>
    protocol.registerSchemesAsPrivileged(
      declarations.map((declaration) => ({
        scheme: TRUSTED_ORIGIN_SCHEMES[declaration.domain],
        privileges: {
          standard: true,
          secure: true,
          supportFetchAPI: true,
          corsEnabled: declaration.corsEnabled,
          ...(declaration.codeCache ? { codeCache: true } : {}),
        },
      })),
    ),
  serve: (domain, handler) => protocol.handle(TRUSTED_ORIGIN_SCHEMES[domain], handler),
  originOf: (domain, host) => `${TRUSTED_ORIGIN_SCHEMES[domain]}://${host}`,
  // A scheme source matches every host of the scheme; hosts differ only by origin.
  sourcesOf: (domain) => [`${TRUSTED_ORIGIN_SCHEMES[domain]}:`],
  // A custom scheme serves every host without allocating anything per host.
  release: () => undefined,
}
