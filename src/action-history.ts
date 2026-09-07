export class ActionHistory<T> {
  private readonly undoStack: T[] = []
  private readonly redoStack: T[] = []
  private readonly limit: number

  constructor(limit = 128) {
    this.limit = limit
  }

  record(entry: T): void {
    this.redoStack.length = 0
    this.pushBounded(this.undoStack, entry)
  }

  takeUndo(): T | undefined {
    return this.undoStack.pop()
  }

  cancelUndo(entry: T): void {
    this.pushBounded(this.undoStack, entry)
  }

  commitUndo(entry: T): void {
    this.pushBounded(this.redoStack, entry)
  }

  takeRedo(): T | undefined {
    return this.redoStack.pop()
  }

  cancelRedo(entry: T): void {
    this.pushBounded(this.redoStack, entry)
  }

  commitRedo(entry: T): void {
    this.pushBounded(this.undoStack, entry)
  }

  undoDepth(): number {
    return this.undoStack.length
  }

  redoDepth(): number {
    return this.redoStack.length
  }

  private pushBounded(stack: T[], entry: T): void {
    if (this.limit <= 0) return
    if (stack.length === this.limit) stack.shift()
    stack.push(entry)
  }
}
