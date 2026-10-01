const ASS_OVERRIDE_TAG = /\{[^}]*}/g;
const HTML_TAG = /<[^>]+>/g;

export interface WrapOptions {
  maxLineLength: number;
  maxLines: number;
}

export const defaultWrapOptions: WrapOptions = {
  maxLineLength: 42,
  maxLines: 2
};

export function cleanAssText(text: string): string {
  return text
    .replace(ASS_OVERRIDE_TAG, "")
    .replace(/\\N|\\n/g, "\n")
    .replace(/\\h/g, " ")
    .trim();
}

export function cleanSubtitleText(text: string): string {
  return text.replace(HTML_TAG, "").replace(/[ \t]+\n/g, "\n").trim();
}

export function normalizeSubtitleWhitespace(text: string): string {
  return text
    .split(/\n+/)
    .map((line) => line.replace(/\s+/g, " ").trim().replace(/^([-–—])(?=\S)/, "$1 "))
    .filter(Boolean)
    .join(" ");
}

export function rewrapSubtitleText(text: string, options = defaultWrapOptions): string {
  const speakerLines = text
    .split(/\n+/)
    .map((line) => line.replace(/\s+/g, " ").trim().replace(/^([-–—])(?=\S)/, "$1 "))
    .filter(Boolean);
  if (
    speakerLines.length > 1 &&
    speakerLines.length <= options.maxLines &&
    speakerLines.every((line) => /^[-–—]\s/.test(line))
  ) {
    return speakerLines.join("\n");
  }

  const normalized = normalizeSubtitleWhitespace(text);
  if (!normalized) {
    return "";
  }

  const words = normalized.split(" ");
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    if (!current) {
      current = word;
      continue;
    }

    if (`${current} ${word}`.length <= options.maxLineLength) {
      current = `${current} ${word}`;
      continue;
    }

    lines.push(current);
    current = word;
  }

  if (current) {
    lines.push(current);
  }

  if (lines.length <= options.maxLines) {
    return lines.join("\n");
  }

  return balanceIntoLines(normalized, options.maxLines);
}

function balanceIntoLines(text: string, maxLines: number): string {
  const words = text.split(" ");
  const totalLength = text.length;
  const targetLength = Math.ceil(totalLength / maxLines);
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    if (lines.length < maxLines - 1 && current && `${current} ${word}`.length > targetLength) {
      lines.push(current);
      current = word;
      continue;
    }

    current = current ? `${current} ${word}` : word;
  }

  if (current) {
    lines.push(current);
  }

  return lines.slice(0, maxLines - 1).concat(lines.slice(maxLines - 1).join(" ")).join("\n");
}
