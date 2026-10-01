/** Keep workers busy as each operation finishes, while preserving input order. */
export async function mapWithConcurrency<T, R>(
  values: readonly T[],
  concurrency: number,
  operation: (value: T, index: number) => Promise<R>
): Promise<R[]> {
  if (!Number.isSafeInteger(concurrency) || concurrency < 1) {
    throw new RangeError("Concurrency must be a positive integer.");
  }
  const results = new Array<R>(values.length);
  let nextIndex = 0;
  let failed = false;
  const workers = Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (!failed && nextIndex < values.length) {
      const index = nextIndex++;
      try {
        results[index] = await operation(values[index], index);
      } catch (error) {
        // Already-running operations finish normally; do not start additional work after a failure.
        failed = true;
        throw error;
      }
    }
  });
  await Promise.all(workers);
  return results;
}
