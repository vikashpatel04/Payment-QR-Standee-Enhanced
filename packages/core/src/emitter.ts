/** A minimal typed event emitter, so the core package needs no Node or Electron imports. */
export class Emitter<Events extends Record<string, unknown>> {
  private readonly handlers = new Map<keyof Events, Set<(payload: never) => void>>();

  on<K extends keyof Events>(event: K, handler: (payload: Events[K]) => void): () => void {
    let set = this.handlers.get(event);
    if (!set) {
      set = new Set();
      this.handlers.set(event, set);
    }
    set.add(handler as (payload: never) => void);
    return () => set.delete(handler as (payload: never) => void);
  }

  protected emit<K extends keyof Events>(event: K, payload: Events[K]): void {
    for (const handler of [...(this.handlers.get(event) ?? [])]) {
      (handler as (payload: Events[K]) => void)(payload);
    }
  }

  removeAllListeners(): void {
    this.handlers.clear();
  }
}

/** An emitter its owner fires from outside, for classes that hold one rather than extend it. */
export class EventHub<Events extends Record<string, unknown>> extends Emitter<Events> {
  fire<K extends keyof Events>(event: K, payload: Events[K]): void {
    this.emit(event, payload);
  }
}
