/**
 * Pi virtual models (docs/virtual-models.md): catalog entries whose router picks a physical model
 * for each request. Pi marks them with the `pi-virtual` API and does not export its own check.
 */
const PI_VIRTUAL_MODEL_API = 'pi-virtual'

export function isPiVirtualModel(model: { readonly api: string }) {
  return model.api === PI_VIRTUAL_MODEL_API
}
