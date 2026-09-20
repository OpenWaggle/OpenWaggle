import { once } from 'node:events'
import net from 'node:net'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  authenticateLocalSessionServer,
  LocalSessionFrameReader,
  resolveLocalSessionClientAuthentication,
} from '../local-session-client-connection'
import { encodeLocalSessionFrame, LocalSessionFrameDecoder } from '../local-session-framing'
import { resolveLocalSessionHostPaths } from '../local-session-paths'
import {
  createLocalSessionServerAuthenticationRequest,
  createLocalSessionServerAuthenticationResponse,
  createLocalSessionServerAuthenticator,
  verifyLocalSessionServerAuthenticationResponse,
} from '../local-session-server-authentication'
import { createProfileCredentialVerifier, generateProfileCredential } from '../profile-credential'

const CREDENTIAL = 'a'.repeat(43)

describe('Local Session server authentication', () => {
  const sockets: net.Socket[] = []
  const servers: net.Server[] = []

  afterEach(async () => {
    for (const socket of sockets) socket.destroy()
    await Promise.all(
      servers.map(
        (server) =>
          new Promise<void>((resolve) => {
            server.close(() => resolve())
          }),
      ),
    )
  })

  it('accepts a response bound to the client nonce and local credential', async () => {
    const request = { kind: 'server-authentication-request' as const, nonce: 'b'.repeat(43) }
    const response = createLocalSessionServerAuthenticationResponse(request, CREDENTIAL)

    await expect(
      verifyLocalSessionServerAuthenticationResponse({
        value: response,
        request,
        credential: CREDENTIAL,
      }),
    ).resolves.toBeUndefined()
  })

  it('authenticates a Windows profile without reading the owner credential', async () => {
    const profile = 'restricted-worker'
    const profileCredential = generateProfileCredential()
    const verifier = await createProfileCredentialVerifier(profileCredential)
    const readOwnerCredential = vi.fn(async () => {
      throw Object.assign(new Error('Access denied.'), { code: 'EACCES' })
    })
    const authentication = await resolveLocalSessionClientAuthentication(
      {
        paths: {
          ...resolveLocalSessionHostPaths({
            userDataRoot: 'C:\\Users\\owner\\OpenWaggle',
            platform: 'win32',
          }),
          endpoint: '\\\\.\\pipe\\openwaggle-profile-test',
        },
        profile,
        profileCredential,
      },
      readOwnerCredential,
    )
    const received: unknown[] = []
    const authenticateServer = createLocalSessionServerAuthenticator({
      localUserCredential: CREDENTIAL,
      resolveProfileCredentialVerifier: async (requestedProfile) =>
        requestedProfile === profile ? verifier : null,
    })
    const server = net.createServer((socket) => {
      sockets.push(socket)
      const decoder = new LocalSessionFrameDecoder()
      socket.on('data', (chunk) => {
        for (const value of decoder.push(chunk)) {
          received.push(value)
          void authenticateServer(value).then((response) => {
            socket.write(encodeLocalSessionFrame(response))
          })
        }
      })
    })
    servers.push(server)
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Expected a TCP address.')
    const client = net.createConnection(address.port, '127.0.0.1')
    sockets.push(client)
    await once(client, 'connect')
    const serverAuthentication = authentication.serverAuthentication
    if (!serverAuthentication?.profile) {
      throw new Error('Expected Windows profile server authentication.')
    }

    await expect(
      authenticateLocalSessionServer({
        socket: client,
        reader: new LocalSessionFrameReader(client),
        credential: serverAuthentication.credential,
        profile: serverAuthentication.profile,
        timeoutMs: 1_000,
      }),
    ).resolves.toBeUndefined()

    expect(readOwnerCredential).not.toHaveBeenCalled()
    expect(received).toHaveLength(1)
    expect(received[0]).toMatchObject({ kind: 'server-authentication-request', profile })
    expect(JSON.stringify(received)).not.toContain(profileCredential)
  })

  it('rejects a profile proof when the caller credential does not match the stored verifier', async () => {
    const profile = 'restricted-worker'
    const credential = generateProfileCredential()
    const verifier = await createProfileCredentialVerifier(credential)
    const request = createLocalSessionServerAuthenticationRequest(profile)
    const authenticateServer = createLocalSessionServerAuthenticator({
      localUserCredential: CREDENTIAL,
      resolveProfileCredentialVerifier: async () => verifier,
    })
    const response = await authenticateServer(request)

    await expect(
      verifyLocalSessionServerAuthenticationResponse({
        value: response,
        request,
        credential: generateProfileCredential(),
      }),
    ).rejects.toThrow('identity verification failed')
  })

  it('never sends the reusable credential to a spoof server with an invalid proof', async () => {
    const received: unknown[] = []
    const server = net.createServer((socket) => {
      sockets.push(socket)
      const decoder = new LocalSessionFrameDecoder()
      socket.on('data', (chunk) => {
        for (const value of decoder.push(chunk)) {
          received.push(value)
          if (received.length === 1) {
            if (
              typeof value !== 'object' ||
              value === null ||
              !('nonce' in value) ||
              typeof value.nonce !== 'string'
            ) {
              throw new Error('Spoof server received an invalid authentication request.')
            }
            const request = value
            socket.write(
              encodeLocalSessionFrame({
                kind: 'server-authentication-response',
                nonce: request.nonce,
                proof: 'z'.repeat(43),
              }),
            )
          }
        }
      })
    })
    servers.push(server)
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Expected a TCP address.')
    const client = net.createConnection(address.port, '127.0.0.1')
    sockets.push(client)
    await once(client, 'connect')

    await expect(
      authenticateLocalSessionServer({
        socket: client,
        reader: new LocalSessionFrameReader(client),
        credential: CREDENTIAL,
        timeoutMs: 1_000,
      }),
    ).rejects.toMatchObject({
      name: 'LocalSessionClientProtocolError',
      code: 'authentication_failed',
      message: expect.stringContaining('identity verification failed'),
    })
    await new Promise((resolve) => setImmediate(resolve))

    expect(received).toHaveLength(1)
    expect(JSON.stringify(received)).not.toContain(CREDENTIAL)
  })
})
