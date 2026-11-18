export function shouldUseHiddenElectron(headless: boolean | undefined) {
  return headless !== false
}
