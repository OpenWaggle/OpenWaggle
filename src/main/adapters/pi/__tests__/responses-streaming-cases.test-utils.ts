import { stream as streamAzureResponses } from '@earendil-works/pi-ai/api/azure-openai-responses'
import { stream as streamOpenAiResponses } from '@earendil-works/pi-ai/api/openai-responses'
import { AZURE_MODELS } from '@earendil-works/pi-ai/providers/azure.models'
import { OPENAI_MODELS } from '@earendil-works/pi-ai/providers/openai.models'
import { withLoopbackServer } from './bedrock-event-stream.test-utils'
import { CONTEXT, DELTAS, finalMessage, sse } from './streaming-provider-wire.test-utils'

/** The write call streamed by Pi's OpenAI Responses and Azure OpenAI Responses providers. */

const RESPONSES_FUNCTION_CALL = {
  type: 'function_call',
  id: 'fc_1',
  call_id: 'tool-1',
  name: 'write',
  arguments: '',
} as const

const RESPONSES_COMPLETED = {
  type: 'response.completed',
  response: {
    id: 'resp_1',
    status: 'completed',
    output: [],
    usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
  },
}

/**
 * How an OpenAI Responses stream of the write call ends. Pi (since 1.0.4) refuses a call whose
 * `output_item.done` never arrived (`unfinished`), so the normal ending closes the item, with no
 * arguments of its own: Pi then parses the whole accumulated JSON.
 */
const RESPONSES_ENDINGS = {
  normal: [
    { type: 'response.output_item.done', output_index: 0, item: RESPONSES_FUNCTION_CALL },
    RESPONSES_COMPLETED,
  ],
  unfinished: [RESPONSES_COMPLETED],
  // The output token limit cut the call off: no output_item.done, and the message stops on length.
  length: [
    {
      type: 'response.incomplete',
      response: {
        ...RESPONSES_COMPLETED.response,
        status: 'incomplete',
        incomplete_details: { reason: 'max_output_tokens' },
      },
    },
  ],
  failure: [{ type: 'error', code: 'server_error', message: 'Upstream failed' }],
} as const

export type ResponsesEnding = keyof typeof RESPONSES_ENDINGS

/** The SSE body of one write call, ending as `ending` says. */
function responsesToolCallStream(ending: ResponsesEnding) {
  return sse(
    [
      { type: 'response.created', response: { id: 'resp_1', status: 'in_progress', output: [] } },
      { type: 'response.output_item.added', output_index: 0, item: RESPONSES_FUNCTION_CALL },
      ...DELTAS.map((delta) => ({
        type: 'response.function_call_arguments.delta',
        output_index: 0,
        item_id: 'fc_1',
        delta,
      })),
      ...RESPONSES_ENDINGS[ending],
    ],
    { named: true },
  )
}

/** One write call streamed by Pi's Azure OpenAI Responses provider, which shares the parser. */
export function runAzureResponsesToolCall(ending: ResponsesEnding) {
  return withLoopbackServer(responsesToolCallStream(ending), 'text/event-stream', (baseUrl) =>
    finalMessage(
      streamAzureResponses(AZURE_MODELS['gpt-4.1'], CONTEXT, {
        apiKey: 'test-key',
        azureBaseUrl: `${baseUrl}/openai/v1`,
        maxRetries: 0,
      }),
    ),
  )
}

/** One write call streamed by Pi's OpenAI Responses provider, ending as `ending` says. */
export function runOpenAiResponsesToolCall(ending: ResponsesEnding) {
  return withLoopbackServer(responsesToolCallStream(ending), 'text/event-stream', (baseUrl) =>
    finalMessage(
      streamOpenAiResponses({ ...OPENAI_MODELS['gpt-4.1'], baseUrl: `${baseUrl}/v1` }, CONTEXT, {
        apiKey: 'test-key',
        maxRetries: 0,
      }),
    ),
  )
}
