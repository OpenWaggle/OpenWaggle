import { electronTrustedOrigins } from '../adapters/electron/electron-trusted-origins'
import type { TrustedOriginsShape } from '../ports/desktop-shell/trusted-origins'

/** The desktop shell's TrustedOrigins (ADR 0064); the shell switch changes only this binding. */
export const trustedOrigins: TrustedOriginsShape = electronTrustedOrigins
