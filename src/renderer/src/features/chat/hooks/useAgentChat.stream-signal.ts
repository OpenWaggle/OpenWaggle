export class StreamSignalVersionStore extends EventTarget {
  private value = 0

  get current() {
    return this.value
  }

  set current(value: number) {
    if (this.value === value) return
    this.value = value
    this.dispatchEvent(new Event('change'))
  }

  readonly getSnapshot = () => this.value

  readonly subscribe = (listener: () => void) => {
    this.addEventListener('change', listener)
    return () => this.removeEventListener('change', listener)
  }
}
