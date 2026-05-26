import type { ExtensionAPI, ExtensionContext } from '@mariozechner/pi-coding-agent'
import { isWaggleInheritedModel, type WaggleTurn } from '@openwaggle/waggle-core'

const FIRST_PROVIDER_CHARACTER_INDEX = 0
const MODEL_ID_START_OFFSET = 1

export type DefaultPiWaggleModel = NonNullable<ExtensionContext['model']>

export interface ModelResolutionContext {
  readonly modelRegistry: Pick<ExtensionContext['modelRegistry'], 'find'>
}

function createModelRefFromProviderQualifiedId(modelReference: string) {
  const separatorIndex = modelReference.indexOf('/')
  if (
    separatorIndex <= FIRST_PROVIDER_CHARACTER_INDEX ||
    separatorIndex === modelReference.length - MODEL_ID_START_OFFSET
  ) {
    throw new Error(`Expected provider/model id, received ${modelReference}`)
  }
  return {
    provider: modelReference.slice(FIRST_PROVIDER_CHARACTER_INDEX, separatorIndex),
    id: modelReference.slice(separatorIndex + MODEL_ID_START_OFFSET),
  }
}

export function modelReferenceForModel(model: DefaultPiWaggleModel) {
  return `${model.provider}/${model.id}`
}

export function effectiveAgentModelReference(agentModel: string, inheritedModelReference: string) {
  return isWaggleInheritedModel(agentModel) ? inheritedModelReference : agentModel
}

export function resolveTurnModel(input: {
  readonly ctx: ModelResolutionContext
  readonly turn: WaggleTurn
  readonly inheritedModelReference: string
}): DefaultPiWaggleModel {
  const effectiveModelReference = effectiveAgentModelReference(
    input.turn.agent.model,
    input.inheritedModelReference,
  )
  const modelReference = createModelRefFromProviderQualifiedId(effectiveModelReference)
  const model = input.ctx.modelRegistry.find(modelReference.provider, modelReference.id)
  if (!model) {
    throw new Error(`Pi model registry could not resolve model ${effectiveModelReference}`)
  }
  return model
}

export async function setTurnModel(input: {
  readonly pi: Pick<ExtensionAPI, 'setModel'>
  readonly ctx: ModelResolutionContext
  readonly turn: WaggleTurn
  readonly inheritedModelReference: string
}): Promise<DefaultPiWaggleModel> {
  const model = resolveTurnModel({
    ctx: input.ctx,
    turn: input.turn,
    inheritedModelReference: input.inheritedModelReference,
  })
  if (!(await input.pi.setModel(model))) {
    throw new Error(
      `Pi model ${effectiveAgentModelReference(
        input.turn.agent.model,
        input.inheritedModelReference,
      )} is not available for Waggle mode`,
    )
  }
  return model
}
