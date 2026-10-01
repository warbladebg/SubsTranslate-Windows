import { isIP } from "node:net";

/** Apply the same URL policy to provider links and every download redirect. */
export function parsePublicHttpsUrl(value: string): URL | undefined {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && !isLocalHostname(url.hostname)
      ? url : undefined;
  } catch {
    return undefined;
  }
}

function isLocalHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) return true;
  if (isIP(host) === 4) return isPrivateIpv4(host);
  if (isIP(host) !== 6) return false;
  const mapped = /^::ffff:([\da-f]{1,4}):([\da-f]{1,4})$/.exec(host);
  if (mapped) {
    const high = parseInt(mapped[1], 16);
    const low = parseInt(mapped[2], 16);
    return isPrivateIpv4(`${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`);
  }
  return host === "::" || host === "::1" || /^(?:fc|fd|fe[89ab])/i.test(host);
}

function isPrivateIpv4(host: string): boolean {
  const [first, second] = host.split(".").map(Number);
  return first === 0 || first === 10 || first === 127
    || (first === 169 && second === 254)
    || (first === 172 && second >= 16 && second <= 31)
    || (first === 192 && second === 168);
}
