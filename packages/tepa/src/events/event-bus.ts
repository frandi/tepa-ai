import type {
  EventMap,
  EventName,
  EventCallback,
  EventRegistration,
  EventContext,
  CycleMetadata,
  DefaultBehaviorCallback,
  DefaultBehaviorMap,
} from "@tepa/types";

interface NormalizedRegistration {
  handler: EventCallback;
  continueOnError: boolean;
}

function normalize(entry: EventCallback | EventRegistration): NormalizedRegistration {
  if (typeof entry === "function") {
    return { handler: entry, continueOnError: false };
  }
  return {
    handler: entry.handler,
    continueOnError: entry.continueOnError ?? false,
  };
}

/**
 * Manages event callback registration and execution.
 * Callbacks run in registration order; each can transform the data for the next.
 * Default behaviors run after all user callbacks unless `preventDefault()` is called.
 */
export class EventBus {
  private readonly callbacks: Map<EventName, NormalizedRegistration[]>;
  private readonly defaults: Map<EventName, DefaultBehaviorCallback>;

  constructor(events?: EventMap, defaults?: DefaultBehaviorMap) {
    this.callbacks = new Map();
    this.defaults = new Map();

    if (events) {
      for (const [name, registrations] of Object.entries(events)) {
        if (!registrations || registrations.length === 0) continue;
        this.callbacks.set(name as EventName, registrations.map(normalize));
      }
    }

    if (defaults) {
      for (const [name, handler] of Object.entries(defaults)) {
        if (handler) {
          this.defaults.set(name as EventName, handler as DefaultBehaviorCallback);
        }
      }
    }
  }

  /**
   * Execute all callbacks registered for the given event.
   * Returns the (potentially transformed) data after all callbacks have run.
   * Default behaviors run after user callbacks unless preventDefault() was called.
   */
  async run<T>(eventName: EventName, data: T, cycle: CycleMetadata): Promise<T> {
    let _defaultPrevented = false;
    const context: EventContext = {
      eventName,
      preventDefault() {
        _defaultPrevented = true;
      },
      get defaultPrevented() {
        return _defaultPrevented;
      },
    };

    const registrations = this.callbacks.get(eventName);

    if (registrations && registrations.length > 0) {
      let current = data;

      for (const { handler, continueOnError } of registrations) {
        const snapshot = current;

        try {
          const result = await (handler as EventCallback<T>)(current, cycle, context);
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

      data = current;
    }

    // Run default behavior after all user callbacks, unless prevented
    if (!_defaultPrevented) {
      const defaultFn = this.defaults.get(eventName);
      if (defaultFn) {
        await defaultFn(data, cycle);
      }
    }

    return data;
  }
}
