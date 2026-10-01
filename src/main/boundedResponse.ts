interface JsonResponseOptions {
  maximumBytes: number;
  provider: string;
}

/** Read provider responses incrementally without retaining a second copy of the byte buffer. */
export async function readBoundedText(response: Response, maximumBytes: number, sizeError: string): Promise<string> {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error(sizeError);
  }
  if (!response.body) return "";

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let received = 0;
  let text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) return text + decoder.decode();
      received += value.byteLength;
      if (received > maximumBytes) throw new Error(sizeError);
      text += decoder.decode(value, { stream: true });
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }
}

export async function readBoundedJson<T>(response: Response, options: JsonResponseOptions): Promise<T> {
  const text = await readBoundedText(
    response, options.maximumBytes, `${options.provider} response exceeded the size limit.`
  );
  if (!response.body) throw new Error(`${options.provider} provider returned an empty response.`);
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`${options.provider} provider returned invalid JSON.`);
  }
}
