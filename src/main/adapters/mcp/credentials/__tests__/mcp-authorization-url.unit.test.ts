import { describe, expect, it } from 'vitest'
import { checkMcpAuthorizationUrl } from '../mcp-authorization-url'

const SERVER = { serverUrl: 'https://mcp.example.com/mcp' }
const DISCOVERED = {
  serverUrl: 'https://mcp.example.com/mcp',
  discovery: {
    authorizationServerUrl: 'https://auth.example.org',
    authorizationServerMetadata: {
      issuer: 'https://auth.example.org',
      authorization_endpoint: 'https://login.example.net/authorize',
    },
  },
}

describe('checkMcpAuthorizationUrl', () => {
  it.each([
    ['the server host', 'https://mcp.example.com/authorize?state=s', SERVER],
    ['the discovered authorization server', 'https://auth.example.org/authorize', DISCOVERED],
    [
      "the discovered server's authorization endpoint",
      'https://login.example.net/authorize',
      DISCOVERED,
    ],
    [
      'a configured authorization server metadata host',
      'https://sso.example.io/oauth/authorize',
      {
        ...SERVER,
        authServerMetadataUrl: 'https://sso.example.io/.well-known/oauth-authorization-server',
      },
    ],
    [
      'plain http on loopback',
      'http://127.0.0.1:8080/authorize',
      { serverUrl: 'http://127.0.0.1:8080/mcp' },
    ],
  ])('accepts %s', (_case, url, origin) => {
    expect(checkMcpAuthorizationUrl(url, origin).href).toBe(new URL(url).href)
  })

  it.each([
    ['a file URL', 'file:///etc/passwd'],
    ['an SMB share', 'smb://mcp.example.com/share'],
    ['ms-msdt', 'ms-msdt:/id PCWDiagnostic'],
    ['a custom scheme', 'vscode://mcp.example.com/authorize'],
    ['javascript', 'javascript:alert(1)'],
    ['plain http to a remote host', 'http://mcp.example.com/authorize'],
    ['credentials in the URL', 'https://user:pass@mcp.example.com/authorize'],
    ['another host', 'https://evil.example/authorize'],
    ['a look-alike subdomain', 'https://mcp.example.com.evil.example/authorize'],
    ['not a URL', 'not a url'],
  ])('refuses %s', (_case, url) => {
    expect(() => checkMcpAuthorizationUrl(url, DISCOVERED)).toThrow()
  })
})
