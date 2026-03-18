import { describe, it, expect, vi } from "vitest";
import type { CycleMetadata, EventMap, EventContext, DefaultBehaviorMap } from "@tepa/types";
import { EventBus } from "../../src/events/event-bus.js";

const baseCycle: CycleMetadata = {
  cycleNumber: 1,
  totalCyclesUsed: 0,
  tokensUsed: 0,
};

describe("EventBus", () => {
  describe("run — basic callback behavior", () => {
    it("single callback transforms data and the transformed data is returned", async () => {
      const events: EventMap = {
        prePlanner: [(data: unknown) => `${data as string}_modified`],
      };
      const bus = new EventBus(events);

      const result = await bus.run("prePlanner", "original", baseCycle);
      expect(result).toBe("original_modified");
    });

    it("multiple callbacks execute in registration order, chaining output", async () => {
      const events: EventMap = {
        postPlanner: [
          (data: unknown) => (data as number) + 1,
          (data: unknown) => (data as number) * 10,
        ],
      };
      const bus = new EventBus(events);

      const result = await bus.run("postPlanner", 5, baseCycle);
      expect(result).toBe(60); // (5 + 1) * 10
    });

    it("callback returning undefined passes data through unchanged", async () => {
      const spy = vi.fn(() => undefined);
      const events: EventMap = {
        preExecutor: [spy],
      };
      const bus = new EventBus(events);

      const data = { key: "value" };
      const result = await bus.run("preExecutor", data, baseCycle);
      expect(result).toBe(data);
      expect(spy).toHaveBeenCalledWith(data, baseCycle, expect.any(Object));
    });

    it("callback returning void passes data through unchanged", async () => {
      const events: EventMap = {
        preExecutor: [
          () => {
            // void — no return
          },
        ],
      };
      const bus = new EventBus(events);

      const result = await bus.run("preExecutor", "passthrough", baseCycle);
      expect(result).toBe("passthrough");
    });

    it("no registered callbacks returns data unchanged", async () => {
      const bus = new EventBus({});
      const data = { foo: "bar" };
      const result = await bus.run("prePlanner", data, baseCycle);
      expect(result).toBe(data);
    });

    it("no EventMap at all returns data unchanged", async () => {
      const bus = new EventBus();
      const result = await bus.run("postEvaluator", 42, baseCycle);
      expect(result).toBe(42);
    });
  });

  describe("run — async callbacks", () => {
    it("async callbacks (returning Promises) are awaited correctly", async () => {
      const events: EventMap = {
        prePlanner: [
          async (data: unknown) => {
            await new Promise((r) => setTimeout(r, 10));
            return (data as number) + 100;
          },
        ],
      };
      const bus = new EventBus(events);

      const result = await bus.run("prePlanner", 1, baseCycle);
      expect(result).toBe(101);
    });

    it("async callbacks chain correctly with sync callbacks", async () => {
      const events: EventMap = {
        postExecutor: [
          (data: unknown) => (data as number) + 1,
          async (data: unknown) => (data as number) * 2,
          (data: unknown) => (data as number) + 10,
        ],
      };
      const bus = new EventBus(events);

      const result = await bus.run("postExecutor", 5, baseCycle);
      expect(result).toBe(22); // ((5 + 1) * 2) + 10
    });
  });

  describe("run — error handling", () => {
    it("throwing callback aborts by default (error propagates)", async () => {
      const events: EventMap = {
        preEvaluator: [
          () => {
            throw new Error("Abort!");
          },
        ],
      };
      const bus = new EventBus(events);

      await expect(bus.run("preEvaluator", "data", baseCycle)).rejects.toThrow("Abort!");
    });

    it("throwing callback with continueOnError: true is skipped, data rolls back", async () => {
      const events: EventMap = {
        postPlanner: [
          (data: unknown) => (data as number) + 10,
          {
            handler: () => {
              throw new Error("Non-critical failure");
            },
            continueOnError: true,
          },
          (data: unknown) => (data as number) * 2,
        ],
      };
      const bus = new EventBus(events);

      // First callback: 5 + 10 = 15
      // Second callback: throws, rolls back to 15
      // Third callback: 15 * 2 = 30
      const result = await bus.run("postPlanner", 5, baseCycle);
      expect(result).toBe(30);
    });

    it("async callback rejection aborts by default", async () => {
      const events: EventMap = {
        prePlanner: [
          async () => {
            throw new Error("Async abort");
          },
        ],
      };
      const bus = new EventBus(events);

      await expect(bus.run("prePlanner", "x", baseCycle)).rejects.toThrow("Async abort");
    });

    it("async callback rejection with continueOnError is skipped", async () => {
      const events: EventMap = {
        preExecutor: [
          {
            handler: async () => {
              throw new Error("Async skip");
            },
            continueOnError: true,
          },
        ],
      };
      const bus = new EventBus(events);

      const result = await bus.run("preExecutor", "preserved", baseCycle);
      expect(result).toBe("preserved");
    });
  });

  describe("run — registration forms", () => {
    it("bare function and { handler, continueOnError } forms both work", async () => {
      const events: EventMap = {
        postEvaluator: [
          (data: unknown) => (data as number) + 1,
          {
            handler: (data: unknown) => (data as number) * 3,
            continueOnError: false,
          },
        ],
      };
      const bus = new EventBus(events);

      const result = await bus.run("postEvaluator", 2, baseCycle);
      expect(result).toBe(9); // (2 + 1) * 3
    });
  });

  describe("run — cycle metadata", () => {
    it("passes correct cycle metadata to each callback", async () => {
      const spy1 = vi.fn();
      const spy2 = vi.fn();

      const events: EventMap = {
        prePlanner: [spy1, spy2],
      };
      const bus = new EventBus(events);

      const cycle: CycleMetadata = {
        cycleNumber: 3,
        totalCyclesUsed: 2,
        tokensUsed: 5000,
      };

      await bus.run("prePlanner", "data", cycle);

      expect(spy1).toHaveBeenCalledWith("data", cycle, expect.any(Object));
      expect(spy2).toHaveBeenCalledWith("data", cycle, expect.any(Object));
    });
  });

  describe("run — EventContext and preventDefault", () => {
    it("passes EventContext as 3rd argument to callbacks", async () => {
      const spy = vi.fn();
      const events: EventMap = {
        postPlanner: [spy],
      };
      const bus = new EventBus(events);

      await bus.run("postPlanner", "data", baseCycle);

      expect(spy).toHaveBeenCalledWith(
        "data",
        baseCycle,
        expect.objectContaining({
          eventName: "postPlanner",
          defaultPrevented: false,
          preventDefault: expect.any(Function),
        }),
      );
    });

    it("EventContext.eventName matches the event being fired", async () => {
      let capturedContext: EventContext | undefined;
      const events: EventMap = {
        preStep: [
          (_data: unknown, _cycle: unknown, ctx?: EventContext) => {
            capturedContext = ctx;
          },
        ],
      };
      const bus = new EventBus(events);

      await bus.run("preStep", {}, baseCycle);

      expect(capturedContext?.eventName).toBe("preStep");
    });

    it("default behavior runs when no user callbacks are registered", async () => {
      const defaultSpy = vi.fn();
      const defaults: DefaultBehaviorMap = {
        postPlanner: defaultSpy,
      };
      const bus = new EventBus(undefined, defaults);

      await bus.run("postPlanner", "plan-data", baseCycle);

      expect(defaultSpy).toHaveBeenCalledWith("plan-data", baseCycle);
    });

    it("default behavior runs after user callbacks", async () => {
      const order: string[] = [];
      const events: EventMap = {
        postPlanner: [
          () => {
            order.push("user");
          },
        ],
      };
      const defaults: DefaultBehaviorMap = {
        postPlanner: () => {
          order.push("default");
        },
      };
      const bus = new EventBus(events, defaults);

      await bus.run("postPlanner", "data", baseCycle);

      expect(order).toEqual(["user", "default"]);
    });

    it("default behavior receives the final transformed data", async () => {
      const defaultSpy = vi.fn();
      const events: EventMap = {
        postPlanner: [(data: unknown) => (data as number) + 10],
      };
      const defaults: DefaultBehaviorMap = {
        postPlanner: defaultSpy,
      };
      const bus = new EventBus(events, defaults);

      await bus.run("postPlanner", 5, baseCycle);

      expect(defaultSpy).toHaveBeenCalledWith(15, baseCycle);
    });

    it("preventDefault() suppresses the default behavior", async () => {
      const defaultSpy = vi.fn();
      const events: EventMap = {
        postStep: [
          (_data: unknown, _cycle: unknown, ctx?: EventContext) => {
            ctx?.preventDefault();
          },
        ],
      };
      const defaults: DefaultBehaviorMap = {
        postStep: defaultSpy,
      };
      const bus = new EventBus(events, defaults);

      await bus.run("postStep", "data", baseCycle);

      expect(defaultSpy).not.toHaveBeenCalled();
    });

    it("preventDefault() in one callback suppresses default even if later callbacks don't call it", async () => {
      const defaultSpy = vi.fn();
      const events: EventMap = {
        postExecutor: [
          (_data: unknown, _cycle: unknown, ctx?: EventContext) => {
            ctx?.preventDefault();
          },
          () => {
            // second callback does not call preventDefault
          },
        ],
      };
      const defaults: DefaultBehaviorMap = {
        postExecutor: defaultSpy,
      };
      const bus = new EventBus(events, defaults);

      await bus.run("postExecutor", "data", baseCycle);

      expect(defaultSpy).not.toHaveBeenCalled();
    });

    it("not calling preventDefault() allows default behavior to run", async () => {
      const defaultSpy = vi.fn();
      const events: EventMap = {
        postPlanner: [
          () => {
            // user callback, does NOT call preventDefault
          },
        ],
      };
      const defaults: DefaultBehaviorMap = {
        postPlanner: defaultSpy,
      };
      const bus = new EventBus(events, defaults);

      await bus.run("postPlanner", "data", baseCycle);

      expect(defaultSpy).toHaveBeenCalledOnce();
    });

    it("default behavior does NOT transform data (side-effect only)", async () => {
      const defaults: DefaultBehaviorMap = {
        postPlanner: () => {
          // side effect only, return value ignored
        },
      };
      const bus = new EventBus(undefined, defaults);

      const result = await bus.run("postPlanner", "original", baseCycle);

      expect(result).toBe("original");
    });

    it("defaultPrevented reflects state after preventDefault() is called", async () => {
      let beforePrevent = false;
      let afterPrevent = false;

      const events: EventMap = {
        postPlanner: [
          (_data: unknown, _cycle: unknown, ctx?: EventContext) => {
            beforePrevent = ctx?.defaultPrevented ?? false;
            ctx?.preventDefault();
            afterPrevent = ctx?.defaultPrevented ?? false;
          },
        ],
      };
      const bus = new EventBus(events);

      await bus.run("postPlanner", "data", baseCycle);

      expect(beforePrevent).toBe(false);
      expect(afterPrevent).toBe(true);
    });

    it("backward compatibility: callbacks with 2 args still work", async () => {
      const events: EventMap = {
        prePlanner: [(data: unknown, _cycle: CycleMetadata) => `${data as string}_ok`],
      };
      const bus = new EventBus(events);

      const result = await bus.run("prePlanner", "test", baseCycle);
      expect(result).toBe("test_ok");
    });

    it("async default behavior is awaited", async () => {
      let executed = false;
      const defaults: DefaultBehaviorMap = {
        postEvaluator: async () => {
          await new Promise((r) => setTimeout(r, 10));
          executed = true;
        },
      };
      const bus = new EventBus(undefined, defaults);

      await bus.run("postEvaluator", "data", baseCycle);

      expect(executed).toBe(true);
    });
  });
});
