/**
 * The identity of a Project action name: unique per project, ignoring letter case and surrounding
 * whitespace (ADR 0038).
 */
export function actionNameKey(name: string) {
  return name.trim().toLocaleLowerCase()
}
