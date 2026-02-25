import type { OAuthFlowStatus } from '@shared/types/auth'
import { isSubscriptionProvider } from '@shared/types/auth'
import { BrowserWindow } from 'electron'
import { disconnect, getAccountInfo, startOAuth, submitCode } from '../auth'
import { typedHandle } from './typed-ipc'

function broadcastOAuthStatus(status: OAuthFlowStatus): void {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send('auth:oauth-status', status)
  }
}

export function registerAuthHandlers(): void {
  typedHandle('auth:start-oauth', async (_event, provider: string) => {
    if (!isSubscriptionProvider(provider)) {
      throw new Error(`Invalid subscription provider: ${provider}`)
    }

    await startOAuth(provider, broadcastOAuthStatus)
  })

  typedHandle('auth:submit-code', (_event, provider: string, code: string) => {
    if (!isSubscriptionProvider(provider)) {
      throw new Error(`Invalid subscription provider: ${provider}`)
    }

    submitCode(provider, code)
  })

  typedHandle('auth:disconnect', (_event, provider: string) => {
    if (!isSubscriptionProvider(provider)) {
      throw new Error(`Invalid subscription provider: ${provider}`)
    }

    disconnect(provider)
    broadcastOAuthStatus({ type: 'idle' })
  })

  typedHandle('auth:get-account-info', async (_event, provider: string) => {
    if (!isSubscriptionProvider(provider)) {
      throw new Error(`Invalid subscription provider: ${provider}`)
    }

    return await getAccountInfo(provider)
  })
}
