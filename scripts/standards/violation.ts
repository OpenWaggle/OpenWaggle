/** A single repository-standards finding. */
export interface Violation {
  readonly file: string
  readonly message: string
  readonly detail?: string
}
