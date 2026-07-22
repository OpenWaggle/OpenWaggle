import { OPENWAGGLE_EXTENSION_BROKER } from '@shared/constants/extension-broker'

function brokerCapabilityMethods(capabilityId: string) {
  return (
    OPENWAGGLE_EXTENSION_BROKER.CAPABILITY_METHODS.find(
      (descriptor) => descriptor.capability === capabilityId,
    )?.methods ?? null
  )
}

function brokerMethodIsSupported(methods: readonly string[], declaredMethod: string) {
  return methods.some((method) => method === declaredMethod)
}

export function validateBrokerCapabilityDeclaration(declaration: {
  readonly id: string
  readonly methods?: readonly string[]
}) {
  const supportedMethods = brokerCapabilityMethods(declaration.id)
  if (supportedMethods === null) {
    return true
  }

  if (declaration.methods === undefined || declaration.methods.length === 0) {
    return `Built-in broker capability "${declaration.id}" must declare at least one supported method.`
  }

  const unsupportedMethods = declaration.methods.filter(
    (method) => !brokerMethodIsSupported(supportedMethods, method),
  )
  if (unsupportedMethods.length > 0) {
    return `Built-in broker capability "${declaration.id}" does not support method "${unsupportedMethods[0]}".`
  }

  return true
}
