import type {
  EventMap,
  EventName,
  EventCallback,
  EventRegistration,
  CycleMetadata,
} from "@tepa/types";

interface NormalizedRegistration {
  handler: EventCallback;
  continueOnError: boolean;
}

function normalize(
  entry: EventCallback | EventRegistration,
): NormalizedRegistration {
  if (typeof entry === "function") {
    return { handler: entry, continueOnError: false };
  }
  return {
    handler: entry.handler,
    continueOnError: entry.continueOnError ?? false,
  };
}

export class EventBus {
  private readonly callbacks: Map<EventName, NormalizedRegistration[]>;

  constructor(events?: EventMap) {
    this.callbacks = new Map();

    if (!events) return;

    for (const [name, registrations] of Object.entries(events)) {
      if (!registrations || registrations.length === 0) continue;
      this.callbacks.set(
        name as EventName,
        registrations.map(normalize),
      );
    }
  }

  async run<T>(eventName: EventName, data: T, cycle: CycleMetadata): Promise<T> {
    const registrations = this.callbacks.get(eventName);
    if (!registrations || registrations.length === 0) {
      return data;
    }

    let current = data;

    for (const { handler, continueOnError } of registrations) {
      const snapshot = current;

      try {
        const result = await (handler as EventCallback<T>)(current, cycle);
        if (result !== undefined && result !== null) {
          current = result;
        }
      } catch (error) {
        if (continueOnError) {
          current = snapshot;
          continue;
        }
        throw error;
      }
    }

    return current;
  }
}
