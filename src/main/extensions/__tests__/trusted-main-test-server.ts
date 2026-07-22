import { createServer } from 'node:https'
import type { AddressInfo } from 'node:net'
import { LOCAL_HTTPS_CERT, LOCAL_HTTPS_KEY } from './trusted-main-test-certificate'

function requireAddressInfo(address: string | AddressInfo | null) {
  if (address === null || typeof address === 'string') {
    throw new Error('Expected HTTPS server to listen on a TCP address.')
  }
  return address
}

export async function listenLocalHttpsServer(input: { readonly onRequest: () => void }) {
  const server = createServer(
    { key: LOCAL_HTTPS_KEY, cert: LOCAL_HTTPS_CERT },
    (_request, response) => {
      input.onRequest()
      response.writeHead(200, { 'content-type': 'text/plain' })
      response.end('ok')
    },
  )

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject)
      resolve()
    })
  })

  const address = requireAddressInfo(server.address())
  return {
    origin: `https://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error)
            return
          }
          resolve()
        })
      }),
  }
}
