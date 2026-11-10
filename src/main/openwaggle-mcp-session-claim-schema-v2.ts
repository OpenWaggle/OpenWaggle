import { z } from 'zod'
import {
  mcpSessionIdSchemaV2,
  mcpSessionPathSchemaV2,
} from './openwaggle-mcp-session-resource-envelope-v2'

export const sessionClaimSchemaV2 = z.strictObject({
  access: z.enum(['read', 'write']),
  target: z.discriminatedUnion('type', [
    z.strictObject({ type: z.literal('workspace-file'), path: mcpSessionPathSchemaV2 }),
    z.strictObject({ type: z.literal('workspace-tree'), path: mcpSessionPathSchemaV2 }),
    z.strictObject({
      type: z.literal('named-resource'),
      scope: z.enum(['project', 'repository']),
      namespace: mcpSessionIdSchemaV2,
      name: mcpSessionIdSchemaV2,
    }),
  ]),
})
