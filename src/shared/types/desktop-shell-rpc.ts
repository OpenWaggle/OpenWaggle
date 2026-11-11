/**
 * The typed RPC between the Electrobun main process and an app webview (ADR 0064): the desktop
 * shell's transport for the IPC channel contract in `@shared/types/ipc`. Its shape is Electrobun's
 * `ElectrobunRPCSchema`. Everything it carries travels as `encodeStructured` JSON
 * (`@shared/structured-wire`), because Electrobun's wire is JSON where Electron's IPC
 * structured-clones.
 *
 * - `shell:invoke` (page to main, request): `window.api` invoking a channel; answers its result.
 * - `shell:send` (page to main): a fire-and-forget `send` channel.
 * - `shell:toggle-devtools` (page to main): the DevTools shortcut of an unpackaged build (F12).
 * - `shell:event` (main to page): one event for `window.api.on(channel)`.
 * - `shell:focus` (main to page): move keyboard focus back into the page, as Electron's
 *   `webContents.focus()` does (the browser preview hands focus back to its owner).
 * - `shell:heartbeat` (main to page, request): whether the page's web process still runs; a page
 *   that stops answering is treated as a gone renderer.
 *
 * Both ends take what arrives as unvalidated, as Electron types it `any`: main-process handlers
 * decode their arguments, and the preload gives results and events their contract types at one
 * boundary (`electrobun-transport.ts`).
 */
export const SHELL_INVOKE_REQUEST = 'shell:invoke'
export const SHELL_SEND_MESSAGE = 'shell:send'
export const SHELL_TOGGLE_DEVTOOLS_MESSAGE = 'shell:toggle-devtools'
export const SHELL_EVENT_MESSAGE = 'shell:event'
export const SHELL_FOCUS_MESSAGE = 'shell:focus'
export const SHELL_HEARTBEAT_REQUEST = 'shell:heartbeat'

/** One channel call: its name and its arguments, not yet decoded by the receiver. */
export interface DesktopShellCall {
  readonly channel: string
  readonly args: readonly unknown[]
}

export interface DesktopShellRpc {
  readonly bun: {
    readonly requests: Readonly<
      Record<
        typeof SHELL_INVOKE_REQUEST,
        { readonly params: DesktopShellCall; readonly response: unknown }
      >
    >
    readonly messages: {
      readonly [SHELL_SEND_MESSAGE]: DesktopShellCall
      readonly [SHELL_TOGGLE_DEVTOOLS_MESSAGE]: undefined
    }
  }
  readonly webview: {
    readonly requests: Readonly<
      Record<
        typeof SHELL_HEARTBEAT_REQUEST,
        { readonly params: undefined; readonly response: true }
      >
    >
    readonly messages: {
      readonly [SHELL_EVENT_MESSAGE]: DesktopShellCall
      readonly [SHELL_FOCUS_MESSAGE]: undefined
    }
  }
}
