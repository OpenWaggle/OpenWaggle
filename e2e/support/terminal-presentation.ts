import type { ElectronApplication } from '@playwright/test'

/** Keep the real compositor presenting while measuring a hidden window. */
export async function captureTerminalPresentation(application: ElectronApplication) {
  const windowId = await application.evaluate(({ BrowserWindow }) => new Promise<number>((resolve, reject) => {
    const window = BrowserWindow.getAllWindows()[0]
    if (!window) throw new Error('Terminal performance window is missing.')
    // backgroundThrottling=false does not keep an unobserved Linux compositor
    // awake. A real presentation subscriber restores the normal display clock
    // without showing/focusing the window or substituting animation callbacks.
    const timeout = setTimeout(() => {
      window.webContents.endFrameSubscription()
      reject(new Error('Hidden terminal compositor did not present a frame.'))
    }, 5_000)
    window.webContents.beginFrameSubscription(true, () => {
      clearTimeout(timeout)
      resolve(window.id)
    })
  }))
  return () => application.evaluate(({ BrowserWindow }, id) => {
    const window = BrowserWindow.fromId(id)
    if (window && !window.isDestroyed()) window.webContents.endFrameSubscription()
  }, windowId)
}
