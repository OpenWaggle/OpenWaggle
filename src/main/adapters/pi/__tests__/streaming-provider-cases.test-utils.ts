import type { AssistantMessage, AssistantMessageEventStream, Model } from '@earendil-works/pi-ai'
import { stream as streamAnthropic } from '@earendil-works/pi-ai/api/anthropic-messages'
import { stream as streamMistral } from '@earendil-works/pi-ai/api/mistral-conversations'
import { stream as streamOpenAiCompletions } from '@earendil-works/pi-ai/api/openai-completions'
import { stream as streamOpenAiResponses } from '@earendil-works/pi-ai/api/openai-responses'
import { stream as streamPiMessages } from '@earendil-works/pi-ai/api/pi-messages'
import { ANTHROPIC_MODELS } from '@earendil-works/pi-ai/providers/anthropic.models'
import { MISTRAL_MODELS } from '@earendil-works/pi-ai/providers/mistral.models'
import { OPENAI_MODELS } from '@earendil-works/pi-ai/providers/openai.models'
import { OPENROUTER_MODELS } from '@earendil-works/pi-ai/providers/openrouter.models'
import { normalizeContext } from '@earendil-works/pi-ai/utils/transcript'
import {
  bedrockEventFrame,
  splitIntoDeltas,
  streamBedrockFrames,
  toolCallFrames,
  withLoopbackServer,
  writeFileArguments,
} from './bedrock-event-stream.test-utils'

/** One write call streamed by each patched Pi provider from a loopback server, in its wire format. */

export const JSON_ARGUMENTS = writeFileArguments(64 * 1024)
const DELTAS = splitIntoDeltas(JSON_ARGUMENTS)
const CONTEXT = normalizeContext({
  messages: [{ role: 'user', content: 'write the file', timestamp: 0 }],
})
const USAGE = { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2 }

export type Ending = 'normal' | 'failure'

export interface ProviderCase {
  readonly name: string
  /** What a normal ending omits: the provider's own close event for the tool block. */
  readonly normalEnding: string
  readonly run: (ending: Ending) => Promise<AssistantMessage>
}

function sse(events: readonly unknown[], options: { readonly named?: boolean } = {}) {
  return events
    .map((event) => {
      const data = `data: ${JSON.stringify(event)}\n\n`
      if (!options.named || typeof event !== 'object' || event === null || !('type' in event)) {
        return data
      }
      return `event: ${String(event.type)}\n${data}`
    })
    .join('')
}

async function finalMessage(events: AssistantMessageEventStream) {
  for await (const _event of events) {
    // Drain the stream; only the final message matters here.
  }
  return events.result()
}

const anthropicCase: ProviderCase = {
  name: 'Anthropic Messages',
  normalEnding: 'message_stop without content_block_stop',
  run: (ending) =>
    withLoopbackServer(
      sse(
        [
          {
            type: 'message_start',
            message: {
              id: 'msg_1',
              type: 'message',
              role: 'assistant',
              model: 'claude-haiku-4-5',
              content: [],
              stop_reason: null,
              usage: { input_tokens: 1, output_tokens: 0 },
            },
          },
          {
            type: 'content_block_start',
            index: 0,
            content_block: { type: 'tool_use', id: 'tool-1', name: 'write', input: {} },
          },
          ...DELTAS.map((partial_json) => ({
            type: 'content_block_delta',
            index: 0,
            delta: { type: 'input_json_delta', partial_json },
          })),
          ...(ending === 'normal'
            ? [
                {
                  type: 'message_delta',
                  delta: { stop_reason: 'tool_use' },
                  usage: { output_tokens: 1 },
                },
                { type: 'message_stop' },
              ]
            : [{ type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } }]),
        ],
        { named: true },
      ),
      'text/event-stream',
      (baseUrl) =>
        finalMessage(
          streamAnthropic({ ...ANTHROPIC_MODELS['claude-haiku-4-5'], baseUrl }, CONTEXT, {
            apiKey: 'test-key',
            maxRetries: 0,
          }),
        ),
    ),
}

const openAiResponsesCase: ProviderCase = {
  name: 'OpenAI Responses',
  normalEnding: 'response.completed without output_item.done',
  run: (ending) =>
    withLoopbackServer(
      sse(
        [
          {
            type: 'response.created',
            response: { id: 'resp_1', status: 'in_progress', output: [] },
          },
          {
            type: 'response.output_item.added',
            output_index: 0,
            item: {
              type: 'function_call',
              id: 'fc_1',
              call_id: 'tool-1',
              name: 'write',
              arguments: '',
            },
          },
          ...DELTAS.map((delta) => ({
            type: 'response.function_call_arguments.delta',
            output_index: 0,
            item_id: 'fc_1',
            delta,
          })),
          ending === 'normal'
            ? {
                type: 'response.completed',
                response: {
                  id: 'resp_1',
                  status: 'completed',
                  output: [],
                  usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
                },
              }
            : { type: 'error', code: 'server_error', message: 'Upstream failed' },
        ],
        { named: true },
      ),
      'text/event-stream',
      (baseUrl) =>
        finalMessage(
          streamOpenAiResponses(
            { ...OPENAI_MODELS['gpt-4.1'], baseUrl: `${baseUrl}/v1` },
            CONTEXT,
            {
              apiKey: 'test-key',
              maxRetries: 0,
            },
          ),
        ),
    ),
}

function chatCompletionChunk(delta: unknown, finishReason: string | null) {
  return {
    id: 'chunk-1',
    object: 'chat.completion.chunk',
    created: 0,
    model: 'test-model',
    choices: [{ index: 0, delta, finish_reason: finishReason }],
  }
}

function chatCompletionToolDeltas() {
  return DELTAS.map((delta, index) =>
    chatCompletionChunk(
      {
        tool_calls: [
          {
            index: 0,
            ...(index === 0 ? { id: 'tool-1', type: 'function' } : {}),
            function: { ...(index === 0 ? { name: 'write' } : {}), arguments: delta },
          },
        ],
      },
      null,
    ),
  )
}

const finishChunk = {
  ...chatCompletionChunk({}, 'tool_calls'),
  usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
}

const openAiCompletionsCase: ProviderCase = {
  name: 'OpenAI Completions',
  normalEnding: 'finish_reason tool_calls',
  run: (ending) =>
    withLoopbackServer(
      `${sse([...chatCompletionToolDeltas(), ...(ending === 'normal' ? [finishChunk] : [])])}data: [DONE]\n\n`,
      'text/event-stream',
      (baseUrl) =>
        finalMessage(
          streamOpenAiCompletions(
            { ...OPENROUTER_MODELS['openai/gpt-4.1'], baseUrl: `${baseUrl}/v1` },
            CONTEXT,
            { apiKey: 'test-key', maxRetries: 0 },
          ),
        ),
    ),
}

const mistralCase: ProviderCase = {
  name: 'Mistral Conversations',
  normalEnding: 'finish_reason tool_calls',
  run: (ending) =>
    withLoopbackServer(
      `${sse([...chatCompletionToolDeltas(), ...(ending === 'normal' ? [finishChunk] : [])])}data: [DONE]\n\n`,
      'text/event-stream',
      (baseUrl) =>
        finalMessage(
          streamMistral({ ...MISTRAL_MODELS['devstral-latest'], baseUrl }, CONTEXT, {
            apiKey: 'test-key',
            maxRetries: 0,
          }),
        ),
    ),
}

const piMessagesModel: Model<'pi-messages'> = {
  id: 'gateway-model',
  name: 'Gateway model',
  api: 'pi-messages',
  provider: 'radius',
  baseUrl: 'http://127.0.0.1',
  reasoning: false,
  input: ['text'],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 200_000,
  maxTokens: 8_192,
}

const piMessagesCase: ProviderCase = {
  name: 'Pi Messages',
  normalEnding: 'done without toolcall_end',
  run: (ending) =>
    withLoopbackServer(
      sse([
        { type: 'start' },
        { type: 'toolcall_start', contentIndex: 0, id: 'tool-1', toolName: 'write' },
        ...DELTAS.map((delta) => ({ type: 'toolcall_delta', contentIndex: 0, delta })),
        ending === 'normal'
          ? { type: 'done', reason: 'toolUse', usage: { ...USAGE, cost: piMessagesModel.cost } }
          : {
              type: 'error',
              reason: 'error',
              usage: { ...USAGE, cost: piMessagesModel.cost },
              errorMessage: 'Gateway failed',
            },
      ]),
      'text/event-stream',
      (baseUrl) =>
        finalMessage(
          streamPiMessages({ ...piMessagesModel, baseUrl }, CONTEXT, { apiKey: 'test-key' }),
        ),
    ),
}

const bedrockCase: ProviderCase = {
  name: 'Amazon Bedrock',
  normalEnding: 'messageStop without contentBlockStop',
  run: (ending) =>
    streamBedrockFrames(
      ending === 'normal'
        ? toolCallFrames(DELTAS, { stopBlock: false })
        : [
            ...toolCallFrames(DELTAS, { stopBlock: false }).slice(0, DELTAS.length + 2),
            bedrockEventFrame('modelStreamErrorException', { message: 'Model stream failed' }),
          ],
      () => undefined,
    ),
}

/** Every Pi provider whose delta path uses `parseStreamingToolArguments`. */
export const STREAMING_TOOL_CALL_PROVIDERS: readonly ProviderCase[] = [
  anthropicCase,
  openAiResponsesCase,
  openAiCompletionsCase,
  mistralCase,
  piMessagesCase,
  bedrockCase,
]
