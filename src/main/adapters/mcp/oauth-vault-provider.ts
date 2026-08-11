import { randomBytes, timingSafeEqual } from 'node:crypto'
import type {
  OAuthClientInformationContext,
  OAuthClientMetadata,
  OAuthClientProvider,
  OAuthDiscoveryState,
  StoredOAuthClientInformation,
  StoredOAuthTokens,
} from '@modelcontextprotocol/client'
import { z } from 'zod'

export interface McpOAuthVault {
  readonly resolve: (name: string) => Promise<string>
  readonly set: (name: string, value: string) => Promise<unknown>
  readonly remove: (name: string) => Promise<unknown>
}

interface PersistedOAuthState {
  readonly version: 1
  readonly tokensByIssuer: Readonly<Record<string, StoredOAuthTokens>>
  readonly clientsByIssuer: Readonly<Record<string, StoredOAuthClientInformation>>
  readonly lastTokenIssuer?: string
  readonly codeVerifier?: string
  readonly state?: string
  readonly discovery?: OAuthDiscoveryState
}

const OAUTH_STATE_BYTES = 32

const storedTokenSchema = z.looseObject({
  access_token: z.string(),
  token_type: z.string(),
  expires_in: z.coerce.number().optional(),
  scope: z.string().optional(),
  refresh_token: z.string().optional(),
  id_token: z.string().optional(),
  issuer: z.string().optional(),
})

const storedClientSchema = z.looseObject({
  client_id: z.string(),
  client_secret: z.string().optional(),
  issuer: z.string().optional(),
})

const discoverySchema = z.custom<OAuthDiscoveryState>(
  (value) =>
    typeof value === 'object' &&
    value !== null &&
    'authorizationServerUrl' in value &&
    typeof value.authorizationServerUrl === 'string',
)

const persistedOAuthStateSchema = z.object({
  version: z.literal(1),
  tokensByIssuer: z.record(z.string(), storedTokenSchema),
  clientsByIssuer: z.record(z.string(), storedClientSchema),
  lastTokenIssuer: z.string().optional(),
  codeVerifier: z.string().optional(),
  state: z.string().optional(),
  discovery: discoverySchema.optional(),
})

function emptyState(): PersistedOAuthState {
  return { version: 1, tokensByIssuer: {}, clientsByIssuer: {} }
}

export function getMcpOAuthVaultKey(instanceId: string) {
  return `oauth.${instanceId}`
}

function issuerKey(context?: OAuthClientInformationContext, stampedIssuer?: string) {
  return context?.issuer ?? stampedIssuer ?? 'unbound'
}

function constantTimeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left)
  const rightBuffer = Buffer.from(right)
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer)
}

export class OpenWaggleOAuthProvider implements OAuthClientProvider {
  readonly clientMetadataUrl?: string
  private authorizationState?: string
  private writeQueue: Promise<void> = Promise.resolve()

  constructor(
    private readonly input: {
      readonly instanceId: string
      readonly redirectUrl: URL
      readonly vault: McpOAuthVault
      readonly scopes?: readonly string[]
      readonly clientMetadataUrl?: string
      readonly onRedirect: (url: URL) => void | Promise<void>
    },
  ) {
    this.clientMetadataUrl = input.clientMetadataUrl
  }

  get redirectUrl() {
    return this.input.redirectUrl
  }

  get clientMetadata(): OAuthClientMetadata {
    return {
      redirect_uris: [this.input.redirectUrl.toString()],
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      application_type: 'native',
      client_name: 'OpenWaggle',
      client_uri: 'https://openwaggle.dev',
      software_id: 'openwaggle',
      ...(this.input.scopes?.length ? { scope: this.input.scopes.join(' ') } : {}),
    }
  }

  private async read(): Promise<PersistedOAuthState> {
    try {
      return persistedOAuthStateSchema.parse(
        JSON.parse(await this.input.vault.resolve(getMcpOAuthVaultKey(this.input.instanceId))),
      )
    } catch (error) {
      if (error instanceof Error && error.message.includes('was not found')) return emptyState()
      throw error
    }
  }

  private async update(mutation: (state: PersistedOAuthState) => PersistedOAuthState) {
    const write = this.writeQueue.then(async () => {
      const next = mutation(await this.read())
      await this.input.vault.set(getMcpOAuthVaultKey(this.input.instanceId), JSON.stringify(next))
    })
    this.writeQueue = write.catch(() => undefined)
    await write
  }

  async state() {
    const state = this.authorizationState ?? randomBytes(OAUTH_STATE_BYTES).toString('base64url')
    this.authorizationState = state
    await this.update((current) => ({ ...current, state }))
    return state
  }

  async clientInformation(context?: OAuthClientInformationContext) {
    const state = await this.read()
    return context ? state.clientsByIssuer[context.issuer] : Object.values(state.clientsByIssuer)[0]
  }

  async saveClientInformation(
    clientInformation: StoredOAuthClientInformation,
    context?: OAuthClientInformationContext,
  ) {
    const issuer = issuerKey(context, clientInformation.issuer)
    await this.update((state) => ({
      ...state,
      clientsByIssuer: { ...state.clientsByIssuer, [issuer]: clientInformation },
    }))
  }

  async tokens(context?: OAuthClientInformationContext) {
    const state = await this.read()
    const issuer = context?.issuer ?? state.lastTokenIssuer
    return issuer ? state.tokensByIssuer[issuer] : undefined
  }

  async saveTokens(tokens: StoredOAuthTokens, context?: OAuthClientInformationContext) {
    const issuer = issuerKey(context, tokens.issuer)
    await this.update((state) => ({
      ...state,
      lastTokenIssuer: issuer,
      tokensByIssuer: { ...state.tokensByIssuer, [issuer]: tokens },
    }))
  }

  redirectToAuthorization(authorizationUrl: URL) {
    return this.input.onRedirect(authorizationUrl)
  }

  async saveCodeVerifier(codeVerifier: string) {
    await this.update((state) => ({ ...state, codeVerifier }))
  }

  async codeVerifier() {
    const verifier = (await this.read()).codeVerifier
    if (!verifier) throw new Error('The MCP OAuth PKCE verifier is missing or expired.')
    return verifier
  }

  async saveDiscoveryState(discovery: OAuthDiscoveryState) {
    await this.update((state) => ({ ...state, discovery }))
  }

  async discoveryState() {
    return (await this.read()).discovery
  }

  async invalidateCredentials(scope: 'all' | 'client' | 'tokens' | 'verifier' | 'discovery') {
    if (scope === 'all') {
      await this.input.vault.remove(getMcpOAuthVaultKey(this.input.instanceId))
      return
    }
    await this.update((state) => ({
      ...state,
      ...(scope === 'client' ? { clientsByIssuer: {} } : {}),
      ...(scope === 'tokens' ? { tokensByIssuer: {}, lastTokenIssuer: undefined } : {}),
      ...(scope === 'verifier' ? { codeVerifier: undefined, state: undefined } : {}),
      ...(scope === 'discovery' ? { discovery: undefined } : {}),
    }))
  }

  async assertCallbackState(received: string | null) {
    const expected = (await this.read()).state
    if (!expected || !received || !constantTimeEqual(expected, received)) {
      throw new Error('MCP OAuth callback state did not match the authorization request.')
    }
  }
}
