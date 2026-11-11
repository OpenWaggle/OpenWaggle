import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import { trustedOriginBasesRendererArguments } from '@shared/trusted-origin-bases-argument'
import type { TrustedOriginsShape } from './ports/desktop-shell/trusted-origins'

/**
 * The renderer arguments naming where the window's page reaches the trusted origins it builds
 * URLs for, on the shell `origins` belongs to: `openwaggle-extension://runtime` on Electron, the
 * extension runtime's loopback base on Electrobun. Each shell's main window passes them.
 */
export function trustedOriginBaseRendererArguments(
  origins: Pick<TrustedOriginsShape, 'originOf'>,
): readonly string[] {
  return trustedOriginBasesRendererArguments({
    extensionRuntime: origins.originOf(
      'extension-runtime',
      OPENWAGGLE_EXTENSION.RUNTIME_MODULE_PROTOCOL.HOST,
    ),
  })
}
