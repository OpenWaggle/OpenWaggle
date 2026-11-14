import { electronTrustedOrigins } from '../adapters/electron/electron-trusted-origins'
import type { TrustedOriginsShape } from '../ports/desktop-shell/trusted-origins'

/** The desktop shell's TrustedOrigins (ADR 0064), bound to its Electron adapter. */
export const trustedOrigins: TrustedOriginsShape = electronTrustedOrigins
