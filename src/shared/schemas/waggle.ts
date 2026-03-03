import { z } from 'zod'

const MAX_ARG_1 = 100

export const waggleAgentColorSchema = z.enum(['blue', 'amber', 'emerald', 'violet'])

export const waggleMetadataSchema = z.object({
  agentIndex: z.number(),
  agentLabel: z.string(),
  agentColor: waggleAgentColorSchema,
  agentModel: z.string().optional(),
  turnNumber: z.number(),
  isSynthesis: z.boolean().optional(),
})

export const waggleAgentSlotSchema = z.object({
  label: z.string(),
  model: z.string(),
  roleDescription: z.string(),
  color: waggleAgentColorSchema,
})

export const waggleConfigSchema = z.object({
  mode: z.enum(['sequential', 'parallel']),
  agents: z.tuple([waggleAgentSlotSchema, waggleAgentSlotSchema]),
  stop: z.object({
    primary: z.enum(['consensus', 'user-stop']),
    maxTurnsSafety: z.number().int().min(1).max(MAX_ARG_1),
  }),
})

export const waggleTeamPresetSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  config: waggleConfigSchema,
  isBuiltIn: z.boolean(),
  createdAt: z.number(),
  updatedAt: z.number(),
})
