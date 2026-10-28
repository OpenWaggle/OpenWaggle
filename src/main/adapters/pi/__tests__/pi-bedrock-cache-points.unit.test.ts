import type { Context } from '@earendil-works/pi-ai'
import { stream as streamBedrock } from '@earendil-works/pi-ai/api/bedrock-converse-stream'
import { AMAZON_BEDROCK_MODELS } from '@earendil-works/pi-ai/providers/amazon-bedrock.models'
import { normalizeContext } from '@earendil-works/pi-ai/utils/transcript'
import { describe, expect, it } from 'vitest'
import {
  BEDROCK_LOOPBACK_ENV as ENV,
  withBedrockServer as withServer,
} from './bedrock-loopback-server.test-utils'

/** The cache points Pi's patched Bedrock transport writes, read from the request it sends. */

const MODEL = AMAZON_BEDROCK_MODELS['eu.anthropic.claude-haiku-4-5-20251001-v1:0']

interface ConverseBody {
  readonly system?: readonly Record<string, unknown>[]
  readonly toolConfig?: { readonly tools: readonly Record<string, unknown>[] }
}

function parseBody(body: string): ConverseBody {
  const parsed: unknown = JSON.parse(body)
  if (typeof parsed !== 'object' || parsed === null) throw new Error('Not a JSON object')
  return parsed
}

const READ_TOOL = {
  name: 'read',
  description: 'Read a file',
  parameters: { type: 'object', properties: { path: { type: 'string' } } },
}

function sectionedContext(): Context {
  return {
    messages: [
      {
        role: 'system',
        content: '',
        sections: {
          preamble: 'You are a coding assistant.',
          skills: '<skills>\nproject skills\n</skills>',
          cwd: '<cwd>\n/work/session-a\n</cwd>',
          openwaggle_session_identity: '<identity>\nsession a\n</identity>',
        },
        toolsAdded: [READ_TOOL],
        timestamp: 0,
      },
      { role: 'user', content: 'hello', timestamp: 1 },
    ],
  }
}

describe('Amazon Bedrock cache points', () => {
  it('caches the tools and the shared system prefix apart from the per-session sections', async () => {
    const body = await withServer(async (baseUrl, requests) => {
      await streamBedrock({ ...MODEL, baseUrl }, normalizeContext(sectionedContext()), {
        region: 'eu-west-1',
        maxRetries: 0,
        env: ENV,
        systemCacheBoundary: 'cwd',
      }).result()
      return parseBody(requests[0]?.body ?? '{}')
    })

    expect(body.system).toEqual([
      { text: 'You are a coding assistant.\n\n<skills>\nproject skills\n</skills>' },
      { cachePoint: { type: 'default' } },
      { text: '<cwd>\n/work/session-a\n</cwd>\n\n<identity>\nsession a\n</identity>' },
      { cachePoint: { type: 'default' } },
    ])
    expect(body.toolConfig?.tools.at(-1)).toEqual({ cachePoint: { type: 'default' } })
    expect(body.toolConfig?.tools).toHaveLength(2)
  })

  it('keeps one system cache point when there is no boundary', async () => {
    const body = await withServer(async (baseUrl, requests) => {
      await streamBedrock({ ...MODEL, baseUrl }, normalizeContext(sectionedContext()), {
        region: 'eu-west-1',
        maxRetries: 0,
        env: ENV,
      }).result()
      return parseBody(requests[0]?.body ?? '{}')
    })

    expect(body.system).toHaveLength(2)
    expect(body.system?.[1]).toEqual({ cachePoint: { type: 'default' } })
  })

  it('writes no tools cache point for a non-Claude model that forces caching', async () => {
    const nova = AMAZON_BEDROCK_MODELS['amazon.nova-pro-v1:0']
    const body = await withServer(async (baseUrl, requests) => {
      await streamBedrock({ ...nova, baseUrl }, normalizeContext(sectionedContext()), {
        region: 'eu-west-1',
        maxRetries: 0,
        env: { ...ENV, AWS_BEDROCK_FORCE_CACHE: '1' },
      }).result()
      return parseBody(requests[0]?.body ?? '{}')
    })

    // Bedrock documents tool checkpoints for Claude only; system ones still apply.
    expect(body.toolConfig?.tools).toHaveLength(1)
    expect(JSON.stringify(body.toolConfig)).not.toContain('cachePoint')
    expect(body.system?.at(-1)).toEqual({ cachePoint: { type: 'default' } })
  })

  it('writes no cache points when prompt caching is off', async () => {
    const body = await withServer(async (baseUrl, requests) => {
      await streamBedrock({ ...MODEL, baseUrl }, normalizeContext(sectionedContext()), {
        region: 'eu-west-1',
        maxRetries: 0,
        env: ENV,
        cacheRetention: 'none',
        systemCacheBoundary: 'cwd',
      }).result()
      return parseBody(requests[0]?.body ?? '{}')
    })

    expect(body.system).toHaveLength(1)
    expect(body.toolConfig?.tools).toHaveLength(1)
  })
})
