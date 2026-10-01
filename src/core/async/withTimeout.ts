import { isAbortError } from "../util/errors";

/**
 * Runs `task` with a signal that aborts after `ms`. When `timeoutMessage` is given,
 * the resulting abort error is replaced by an Error with that message (cause kept).
 */
export async function withTimeout<T>(
  ms: number,
  task: (signal: AbortSignal) => Promise<T>,
  timeoutMessage?: string
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await task(controller.signal);
  } catch (error) {
    if (timeoutMessage && isAbortError(error)) {
      throw new Error(timeoutMessage, { cause: error });
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
