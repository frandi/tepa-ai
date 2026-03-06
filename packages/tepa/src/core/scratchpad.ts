/**
 * In-memory key-value store that persists across execution steps within a pipeline run.
 * Reset between runs by the orchestrator.
 */
export class Scratchpad {
  private store = new Map<string, unknown>();

  read(key: string): unknown {
    return this.store.get(key);
  }

  has(key: string): boolean {
    return this.store.has(key);
  }

  write(key: string, value: unknown): void {
    this.store.set(key, value);
  }

  entries(): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const [key, value] of this.store) {
      result[key] = value;
    }
    return result;
  }

  clear(): void {
    this.store.clear();
  }
}
