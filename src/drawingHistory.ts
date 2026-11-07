/** A bounded history of serializable chart states (drawings, studies, chart type), never live trading overlays. */
export class DrawingHistory<T> {
  private states: string[] = []
  private labels: string[] = []
  private index = -1

  constructor (private readonly limit = 100) {}

  reset (state: T): void {
    this.states = [JSON.stringify(state)]
    this.labels = ['']
    this.index = 0
  }

  record (state: T, label = ''): void {
    const next = JSON.stringify(state)
    if (next === this.states[this.index]) return
    this.states = this.states.slice(0, this.index + 1)
    this.labels = this.labels.slice(0, this.index + 1)
    this.states.push(next)
    this.labels.push(label)
    if (this.states.length > this.limit + 1) {
      this.states.shift()
      this.labels.shift()
    }
    this.index = this.states.length - 1
  }

  get canUndo (): boolean { return this.index > 0 }
  get canRedo (): boolean { return this.index < this.states.length - 1 }
  get undoLabel (): string { return this.canUndo ? this.labels[this.index] : '' }
  get redoLabel (): string { return this.canRedo ? this.labels[this.index + 1] : '' }

  undo (): T | null {
    return this.canUndo ? JSON.parse(this.states[--this.index]) : null
  }

  redo (): T | null {
    return this.canRedo ? JSON.parse(this.states[++this.index]) : null
  }
}
