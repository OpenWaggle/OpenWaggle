/**
 * A frame its sender serialized already, so encoding it does not serialize it again. Its `kind`
 * stays readable for whatever inspects outbound frames.
 */
export class SerializedLocalSessionFrame {
  readonly kind: string
  readonly json: string

  constructor(kind: string, json: string) {
    this.kind = kind
    this.json = json
  }
}
