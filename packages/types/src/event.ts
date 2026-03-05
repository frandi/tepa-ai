export type EventName =
  | "prePlanner"
  | "postPlanner"
  | "preExecutor"
  | "postExecutor"
  | "preEvaluator"
  | "postEvaluator";

export interface CycleMetadata {
  cycleNumber: number;
  totalCyclesUsed: number;
  tokensUsed: number;
}

export type EventCallback<TData = unknown> = (
  data: TData,
  cycle: CycleMetadata,
) => TData | void | Promise<TData | void>;

export interface EventRegistration<TData = unknown> {
  handler: EventCallback<TData>;
  continueOnError?: boolean;
}

export type EventMap = {
  [K in EventName]?: Array<EventCallback | EventRegistration>;
};
