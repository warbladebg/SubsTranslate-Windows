import { net } from "electron";

/**
 * Main-process HTTP transport. Electron's net.fetch uses Chromium's network
 * stack instead of Node's bundled Undici parser.
 */
export const electronFetch: typeof fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
  const request = input instanceof URL ? input.toString() : input;
  return net.fetch(request, init) as Promise<Response>;
}) as typeof fetch;
