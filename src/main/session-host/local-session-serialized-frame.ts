/**
 * A frame its sender serialized already, so encoding it does not serialize it again. Its `kind`
 * stays readable for whatever inspects outbound frames.
 */
export class SerializedLocalSessionFrame {
  constructor(
    readonly kind: string,
    readonly json: string,
  ) {}
}
