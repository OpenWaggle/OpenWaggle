import { electrobunTrustedOrigins } from '../adapters/electrobun/electrobun-trusted-origins'
import type { TrustedOriginsShape } from '../ports/desktop-shell/trusted-origins'

/** The desktop shell's TrustedOrigins (ADR 0064), bound to its Electrobun adapter. */
export const trustedOrigins: TrustedOriginsShape = electrobunTrustedOrigins
