/**
 * Hexagonal architecture ports.
 *
 * Each port is an Effect Context.Tag service defining a domain-owned interface.
 * Adapters provide Layer implementations that satisfy these tags.
 * Application services and the agent loop consume them via `yield*`.
 */

export type { ChatAdapter } from './chat-adapter-type'
export { unwrapChatAdapter, wrapChatAdapter } from './chat-adapter-type'
export type { ChatServiceShape, ChatStreamOptions, TestConnectionOptions } from './chat-service'
export { ChatService } from './chat-service'
export type { ConversationRepositoryShape } from './conversation-repository'
export { ConversationRepository } from './conversation-repository'
export type { ProviderCapabilities, ProviderServiceShape } from './provider-service'
export { ProviderService } from './provider-service'
export type { LoadStandardsOptions, StandardsServiceShape } from './standards-service'
export { StandardsService } from './standards-service'
export type { TeamsRepositoryShape } from './teams-repository'
export { TeamsRepository } from './teams-repository'
export type { DomainServerTool, NamedDomainServerTool } from './tool-types'
