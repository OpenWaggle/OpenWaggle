export function loadSessionTreePanel() {
  return import('./SessionTreePanel').then((module) => ({
    default: module.SessionTreePanel,
  }))
}
