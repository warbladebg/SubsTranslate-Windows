import { describe, expect, it, vi } from "vitest";
import { readBoundedJson, readBoundedText } from "../src/main/boundedResponse";

const options = { maximumBytes: 32, provider: "Test" };

describe("bounded provider responses", () => {
  it("decodes UTF-8 characters split across chunks without corrupting them", async () => {
    const encoded = new TextEncoder().encode('{"title":"Здрасти"}');
    const body = new ReadableStream<Uint8Array>({ start(controller) {
      for (const byte of encoded) controller.enqueue(Uint8Array.of(byte));
      controller.close();
    } });
    const response = new Response(body);
    await expect(readBoundedJson(response, options)).resolves.toEqual({ title: "Здрасти" });
    expect(response.body?.locked).toBe(false);
  });

  it.each([true, false])("cancels oversized bodies and releases their lock (declared length: %s)", async (declared) => {
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new Uint8Array(33)); }, cancel
    });
    const response = new Response(body, { headers: declared ? { "content-length": "33" } : {} });
    await expect(readBoundedJson(response, options)).rejects.toThrow(/size limit/);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(body.locked).toBe(false);
  });

  it("preserves transport errors and reports invalid JSON separately", async () => {
    const error = new Error("disconnected");
    const response = new Response(new ReadableStream({ start(controller) { controller.error(error); } }));
    await expect(readBoundedJson(response, options)).rejects.toBe(error);
    expect(response.body?.locked).toBe(false);
    await expect(readBoundedJson(new Response("not json"), options)).rejects.toThrow(/invalid JSON/);
    await expect(readBoundedJson(new Response(null), options)).rejects.toThrow(/empty response/);
    await expect(readBoundedText(new Response("123"), 3, "too large")).resolves.toBe("123");
  });
});
