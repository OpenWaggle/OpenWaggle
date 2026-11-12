import { Schema } from 'effect'
import { enumeration, literal } from './json-schema-primitives'
import {
  mcpSessionIdSchemaV2,
  mcpSessionPathSchemaV2,
} from './openwaggle-mcp-session-resource-envelope-v2'

export const sessionClaimSchemaV2 = Schema.Struct({
  access: enumeration('read', 'write'),
  target: Schema.Union(
    Schema.Struct({ type: literal('workspace-file'), path: mcpSessionPathSchemaV2 }),
    Schema.Struct({ type: literal('workspace-tree'), path: mcpSessionPathSchemaV2 }),
    Schema.Struct({
      type: literal('named-resource'),
      scope: enumeration('project', 'repository'),
      namespace: mcpSessionIdSchemaV2,
      name: mcpSessionIdSchemaV2,
    }),
  ),
})
