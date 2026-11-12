import { electronWebSecurity } from '../adapters/electron/electron-web-security'
import type { WebSecurityShape } from '../ports/desktop-shell/web-security'

/** The desktop shell's WebSecurity (ADR 0064); the shell switch changes only this binding. */
export const webSecurity: WebSecurityShape = electronWebSecurity
