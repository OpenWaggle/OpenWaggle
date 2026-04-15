import { createServer, type Server } from 'node:http'
import { URL } from 'node:url'
import { AUTH_TIMEOUT } from '@shared/constants/timeouts'
import { createLogger } from '../logger'

const HTTP_STATUS_OK = 200
const HTTP_STATUS_BAD_REQUEST = 400

const logger = createLogger('oauth-callback')

const SUCCESS_HTML = `<!DOCTYPE html>
<html><head><title>Authentication Successful</title>
<style>body{font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#111;color:#eee;}
.c{text-align:center;}.check{font-size:48px;margin-bottom:16px;}</style></head>
<body><div class="c"><div class="check">&#10003;</div><h1>Authentication successful</h1><p>You can close this window and return to OpenWaggle.</p></div></body></html>`

const ERROR_HTML = `<!DOCTYPE html>
<html><head><title>Authentication Failed</title>
<style>body{font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#111;color:#eee;}
.c{text-align:center;}.x{font-size:48px;margin-bottom:16px;color:#f87171;}</style></head>
<body><div class="c"><div class="x">&#10007;</div><h1>Authentication failed</h1><p>Please close this window and try again in OpenWaggle.</p></div></body></html>`

interface CallbackResult {
  readonly code: string
  readonly state?: string
}

interface CallbackServer {
  readonly port: number
  waitForCallback(): Promise<CallbackResult>
  close(): void
}

export async function createCallbackServer(options?: { port?: number }): Promise<CallbackServer> {
  let resolveCallback: ((result: CallbackResult) => void) | null = null
  let rejectCallback: ((error: Error) => void) | null = null
  let timeoutId: ReturnType<typeof setTimeout> | null = null

  const server: Server = createServer((req, res) => {
    if (!req.url) {
      res.writeHead(HTTP_STATUS_BAD_REQUEST)
      res.end('Bad request')
      return
    }

    const url = new URL(req.url, 'http://localhost')

    // Handle OAuth error responses (standard error parameter)
    const oauthError = url.searchParams.get('error')
    if (oauthError) {
      const errorDescription =
        url.searchParams.get('error_description') ?? 'Authorization was denied'
      res.writeHead(HTTP_STATUS_OK, { 'Content-Type': 'text/html' })
      res.end(ERROR_HTML)

      if (rejectCallback) {
        rejectCallback(new Error(`OAuth authorization denied: ${errorDescription}`))
        resolveCallback = null
        rejectCallback = null
      }
      return
    }

    const code = url.searchParams.get('code')

    if (!code) {
      res.writeHead(HTTP_STATUS_BAD_REQUEST)
      res.end('Missing authorization code')
      return
    }

    const state = url.searchParams.get('state') ?? undefined

    res.writeHead(HTTP_STATUS_OK, { 'Content-Type': 'text/html' })
    res.end(SUCCESS_HTML)

    if (resolveCallback) {
      resolveCallback({ code, state })
      resolveCallback = null
      rejectCallback = null
    }
  })

  const requestedPort = options?.port ?? 0

  const resolvedPort = await new Promise<number>((resolve, reject) => {
    server.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        reject(
          new Error(
            `Port ${requestedPort} is already in use. Close the application using it and try again.`,
          ),
        )
      } else {
        reject(err)
      }
    })
    server.listen(requestedPort, '127.0.0.1', () => {
      const addr = server.address()
      const port = typeof addr === 'object' && addr !== null ? addr.port : requestedPort
      resolve(port)
    })
  })

  logger.info('OAuth callback server started', { port: resolvedPort })

  return {
    port: resolvedPort,
    waitForCallback(): Promise<CallbackResult> {
      return new Promise<CallbackResult>((resolve, reject) => {
        resolveCallback = resolve
        rejectCallback = reject

        timeoutId = setTimeout(() => {
          reject(new Error('OAuth callback timed out after 5 minutes'))
          server.close()
        }, AUTH_TIMEOUT.OAUTH_CALLBACK_MS)
      })
    },
    close() {
      if (timeoutId) {
        clearTimeout(timeoutId)
        timeoutId = null
      }
      if (rejectCallback) {
        rejectCallback(new Error('OAuth callback server closed'))
        rejectCallback = null
        resolveCallback = null
      }
      server.close()
      logger.info('OAuth callback server closed')
    },
  }
}
