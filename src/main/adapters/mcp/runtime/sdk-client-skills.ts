import type { Client } from '@modelcontextprotocol/client'
import { MCP_CONFIG } from '@shared/constants/mcp'
import { decodeUnknownOrThrow } from '@shared/schema'
import { mcpConfigValueSchema } from '@shared/schemas/mcp'
import { z } from 'zod'

const skillResourceSchema = z.object({
  uri: z.string().min(1),
  digest: z.string().regex(/^sha256:[0-9a-f]{64}$/),
})

const skillEntrySchema = z.object({
  uri: z.string().min(1),
  frontmatter: z.record(z.string(), z.unknown()),
  resources: z.array(skillResourceSchema).max(MCP_CONFIG.MAX_REMOTE_SKILL_RESOURCES).optional(),
})

const listSkillsResultSchema = z.object({
  skills: z.array(skillEntrySchema).max(MCP_CONFIG.MAX_REMOTE_SKILLS),
  nextCursor: z.string().optional(),
  ttlMs: z.number().nonnegative().optional(),
  cacheScope: z.string().optional(),
})

const getSkillResultSchema = z.object({ skill: skillEntrySchema })

function toJsonValue(value: unknown) {
  const serialized = JSON.stringify(value)
  if (serialized === undefined) throw new Error('MCP Skills response was not JSON serializable.')
  const parsed: unknown = JSON.parse(serialized)
  return decodeUnknownOrThrow(mcpConfigValueSchema, parsed)
}

function requestOptions(signal?: AbortSignal) {
  return {
    signal,
    timeout: MCP_CONFIG.REQUEST_TIMEOUT_MS,
    maxTotalTimeout: MCP_CONFIG.REQUEST_TIMEOUT_MS,
  }
}

export function createMcpSkillMethods(client: Client) {
  return {
    async listSkills(signal?: AbortSignal) {
      const skills: unknown[] = []
      let cursor: string | undefined
      for (let page = 0; page < MCP_CONFIG.MAX_LIST_PAGES; page += 1) {
        const result = await client.request(
          { method: 'skills/list', params: cursor ? { cursor } : {} },
          listSkillsResultSchema,
          requestOptions(signal),
        )
        skills.push(...result.skills)
        if (skills.length > MCP_CONFIG.MAX_REMOTE_SKILLS) {
          throw new Error(`MCP Skills listing exceeds ${MCP_CONFIG.MAX_REMOTE_SKILLS} entries.`)
        }
        if (!result.nextCursor) return toJsonValue({ skills })
        cursor = result.nextCursor
      }
      throw new Error(`MCP Skills listing exceeded ${MCP_CONFIG.MAX_LIST_PAGES} pages.`)
    },
    async getSkill(input: { readonly uri: string; readonly signal?: AbortSignal }) {
      return toJsonValue(
        await client.request(
          { method: 'skills/get', params: { uri: input.uri } },
          getSkillResultSchema,
          requestOptions(input.signal),
        ),
      )
    },
  }
}
