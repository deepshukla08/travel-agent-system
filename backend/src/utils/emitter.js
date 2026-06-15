/**
 * AsyncLocalStorage-based SSE emitter.
 * Agents call `emit(type, data)` without knowing about HTTP.
 * The route sets the emitter before invoking the graph.
 */
import { AsyncLocalStorage } from "async_hooks";

export const emitterStorage = new AsyncLocalStorage();

/**
 * Emit an SSE event. No-op if no emitter is set (e.g., in tests / CLI runs).
 */
export function emit(type, data) {
  const fn = emitterStorage.getStore();
  if (typeof fn === "function") {
    fn(type, data);
  }
}
