import type {
  AnyTextAdapter,
  ConstrainedModelMessage,
  StreamChunk,
  TextOptions,
  UIMessage,
} from '@tanstack/ai'

type OpenWaggleChatMessage<TAdapter extends AnyTextAdapter> =
  | UIMessage
  | ConstrainedModelMessage<{
      inputModalities: TAdapter['~types']['inputModalities']
      messageMetadataByModality: TAdapter['~types']['messageMetadataByModality']
    }>

declare module '@tanstack/ai' {
  export function chat<TAdapter extends AnyTextAdapter>(options: {
    readonly adapter: TAdapter
    readonly messages?: Array<OpenWaggleChatMessage<TAdapter>>
    readonly systemPrompts?: TextOptions['systemPrompts']
    readonly tools?: TextOptions['tools']
    readonly temperature?: TextOptions['temperature']
    readonly topP?: TextOptions['topP']
    readonly maxTokens?: TextOptions['maxTokens']
    readonly metadata?: TextOptions['metadata']
    readonly modelOptions?: TAdapter['~types']['providerOptions']
    readonly abortController?: TextOptions['abortController']
    readonly agentLoopStrategy?: TextOptions['agentLoopStrategy']
    readonly conversationId?: TextOptions['conversationId']
    readonly stream?: true | undefined
    readonly outputSchema?: undefined
  }): AsyncIterable<StreamChunk>
}
