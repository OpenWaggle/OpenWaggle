export interface ReviewComment {
  readonly id: string
  readonly filePath: string
  readonly startLine: number
  readonly endLine: number
  readonly content: string
  readonly createdAt: number
}
