import { z } from 'zod'

export const agentColorSchema = z.enum(['blue', 'amber', 'emerald', 'violet'])

export const multiAgentMetadataSchema = z.object({
  agentIndex: z.number(),
  agentLabel: z.string(),
  agentColor: agentColorSchema,
  agentModel: z.string().optional(),
  turnNumber: z.number(),
  isSynthesis: z.boolean().optional(),
})

export const agentSlotSchema = z.object({
  label: z.string(),
  model: z.string(),
  roleDescription: z.string(),
  color: agentColorSchema,
})

export const multiAgentConfigSchema = z.object({
  mode: z.enum(['sequential', 'parallel']),
  agents: z.tuple([agentSlotSchema, agentSlotSchema]),
  stop: z.object({
    primary: z.enum(['consensus', 'user-stop']),
    maxTurnsSafety: z.number().int().min(1).max(100),
  }),
})

export const teamPresetSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  config: multiAgentConfigSchema,
  isBuiltIn: z.boolean(),
  createdAt: z.number(),
  updatedAt: z.number(),
})
