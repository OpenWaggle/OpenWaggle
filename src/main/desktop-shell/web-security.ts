import { createElectrobunWebSecurity } from '../adapters/electrobun/electrobun-web-security'
import type { WebSecurityShape } from '../ports/desktop-shell/web-security'

/** The desktop shell's WebSecurity (ADR 0064), bound to its Electrobun adapter. */
export const webSecurity: WebSecurityShape = createElectrobunWebSecurity()
