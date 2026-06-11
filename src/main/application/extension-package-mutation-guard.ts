const RESERVED_PACKAGE_MUTATION_CAPABILITIES = Object.freeze([
  'openwaggle.extensions.packages',
  'openwaggle.extension-packages',
] as const)

export const EXTENSION_PACKAGE_MUTATION_CAPABILITY_REJECTION =
  'Extension package mutation is not available through extension SDK capabilities. Use the user-approved extension package workflow.'

export function isExtensionPackageMutationCapability(capability: string) {
  return RESERVED_PACKAGE_MUTATION_CAPABILITIES.some((reserved) => reserved === capability)
}
