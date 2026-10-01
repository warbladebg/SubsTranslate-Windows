export interface PgsBitmapCue {
  id: number;
  startMs: number;
  endMs: number;
  width: number;
  height: number;
  x: number;
  y: number;
  rgba: Uint8Array;
}

interface PaletteEntry {
  y: number;
  cb: number;
  cr: number;
  alpha: number;
}

interface CompositionObject {
  objectId: number;
  x: number;
  y: number;
  crop?: { x: number; y: number; width: number; height: number };
}

interface ObjectBuffer {
  width?: number;
  height?: number;
  chunks: Buffer[];
  version: number;
  generation: number;
}

interface PresentationComposition {
  paletteId: number;
  objects: CompositionObject[];
}

const SEGMENT_PALETTE = 0x14;
const SEGMENT_OBJECT = 0x15;
const SEGMENT_PRESENTATION = 0x16;
const SEGMENT_END = 0x80;

export function parsePgsSup(input: Buffer): PgsBitmapCue[] {
  const palettes = new Map<number, Map<number, PaletteEntry>>();
  const objects = new Map<number, ObjectBuffer>();
  const cues: PgsBitmapCue[] = [];
  let pending: { ptsMs: number; composition: PresentationComposition } | undefined;
  let active: { startMs: number; signature: string; bitmap: Omit<PgsBitmapCue, "id" | "startMs" | "endMs"> } | undefined;
  let lastPtsMs = 0;
  let objectGeneration = 0;

  for (const segment of readSegments(input)) {
    lastPtsMs = Math.max(lastPtsMs, segment.ptsMs);

    if (segment.type === SEGMENT_PRESENTATION) {
      // Some muxers omit END segments. A following PCS still starts a new
      // display set, so finalize the previous one before replacing it.
      commitPending();
      pending = { ptsMs: segment.ptsMs, composition: parsePresentation(segment.payload) };
      continue;
    }

    if (segment.type === SEGMENT_PALETTE) {
      parsePalette(segment.payload, palettes);
      continue;
    }

    if (segment.type === SEGMENT_OBJECT) {
      objectGeneration += 1;
      parseObject(segment.payload, objects, objectGeneration);
      continue;
    }

    if (segment.type === SEGMENT_END) {
      commitPending();
    }
  }

  commitPending();
  if (active) {
    closeActive(Math.max(lastPtsMs, active.startMs + 3000));
  }

  return cues;

  function commitPending(): void {
    if (!pending) {
      return;
    }

    const { ptsMs, composition } = pending;
    const rendered = renderComposition(composition, objects, palettes);
    const signature = rendered ? compositionSignature(composition, objects) : "";

    if (active && (!rendered || signature !== active.signature)) {
      closeActive(ptsMs);
    }

    if (rendered && !active) {
      active = { startMs: ptsMs, signature, bitmap: rendered };
    } else if (rendered && active) {
      // Palette-only display sets are commonly used for fades. Preserve one
      // textual cue while retaining the best (latest) rendered bitmap.
      active.bitmap = rendered;
    }

    pending = undefined;
  }

  function closeActive(endMs: number): void {
    if (!active) {
      return;
    }
    cues.push({
      id: cues.length + 1,
      startMs: active.startMs,
      endMs: Math.max(active.startMs + 250, endMs),
      ...active.bitmap
    });
    active = undefined;
  }
}

export function decodePgsRle(
  data: Buffer,
  width: number,
  height: number,
  palette: Map<number, PaletteEntry>
): Uint8Array {
  const pixels = new Uint8Array(width * height * 4);
  let inputOffset = 0;
  let pixelOffset = 0;
  let x = 0;
  let y = 0;

  const writeRun = (count: number, colorIndex: number): void => {
    const color = palette.get(colorIndex) ?? { y: 0, cb: 128, cr: 128, alpha: 0 };
    const [red, green, blue, alpha] = yCbCrToRgba(color);

    // PGS rows are terminated by an explicit 00 00 end-of-line opcode. Do not
    // also advance the row when a run reaches `width`, otherwise the following
    // EOL skips a row and produces an alternating-line/"venetian blind" image.
    for (let index = 0; index < count && y < height && x < width; index += 1) {
      pixelOffset = (y * width + x) * 4;
      pixels[pixelOffset] = red;
      pixels[pixelOffset + 1] = green;
      pixels[pixelOffset + 2] = blue;
      pixels[pixelOffset + 3] = alpha;
      x += 1;
    }
  };

  while (inputOffset < data.length && y < height) {
    const value = data[inputOffset++];
    if (value !== 0) {
      writeRun(1, value);
      continue;
    }

    if (inputOffset >= data.length) {
      break;
    }

    const control = data[inputOffset++];
    if (control === 0) {
      x = 0;
      y += 1;
      continue;
    }

    const mode = control & 0xc0;
    if (mode === 0x00) {
      writeRun(control & 0x3f, 0);
    } else if (mode === 0x40) {
      const count = ((control & 0x3f) << 8) + data[inputOffset++];
      writeRun(count, 0);
    } else if (mode === 0x80) {
      const count = control & 0x3f;
      const colorIndex = data[inputOffset++];
      writeRun(count, colorIndex);
    } else {
      const count = ((control & 0x3f) << 8) + data[inputOffset++];
      const colorIndex = data[inputOffset++];
      writeRun(count, colorIndex);
    }
  }

  return pixels;
}

function* readSegments(input: Buffer): Generator<{ type: number; ptsMs: number; payload: Buffer }> {
  let offset = 0;
  while (offset + 13 <= input.length) {
    if (input[offset] !== 0x50 || input[offset + 1] !== 0x47) {
      offset += 1;
      continue;
    }

    const pts90k = input.readUInt32BE(offset + 2);
    const type = input[offset + 10];
    const length = input.readUInt16BE(offset + 11);
    const payloadStart = offset + 13;
    const payloadEnd = payloadStart + length;
    if (payloadEnd > input.length) {
      break;
    }

    yield {
      type,
      ptsMs: Math.round(pts90k / 90),
      payload: input.subarray(payloadStart, payloadEnd)
    };
    offset = payloadEnd;
  }
}

function parsePalette(payload: Buffer, palettes: Map<number, Map<number, PaletteEntry>>): void {
  if (payload.length < 2) {
    return;
  }
  const paletteId = payload[0];
  const palette = palettes.get(paletteId) ?? new Map<number, PaletteEntry>();
  for (let offset = 2; offset + 4 < payload.length; offset += 5) {
    palette.set(payload[offset], {
      y: payload[offset + 1],
      cr: payload[offset + 2],
      cb: payload[offset + 3],
      alpha: payload[offset + 4]
    });
  }
  palettes.set(paletteId, palette);
}

function parsePresentation(payload: Buffer): PresentationComposition {
  if (payload.length < 11) {
    return { paletteId: 0, objects: [] };
  }

  const paletteId = payload[9];
  const objectCount = payload[10];
  const objects: CompositionObject[] = [];
  let offset = 11;

  for (let index = 0; index < objectCount && offset + 7 <= payload.length; index += 1) {
    const objectId = payload.readUInt16BE(offset);
    const flags = payload[offset + 3];
    const x = payload.readUInt16BE(offset + 4);
    const y = payload.readUInt16BE(offset + 6);
    const cropped = (flags & 0x80) !== 0;
    if (cropped && offset + 15 < payload.length) {
      objects.push({
        objectId,
        x,
        y,
        crop: {
          x: payload.readUInt16BE(offset + 8),
          y: payload.readUInt16BE(offset + 10),
          width: payload.readUInt16BE(offset + 12),
          height: payload.readUInt16BE(offset + 14)
        }
      });
    } else {
      objects.push({ objectId, x, y });
    }
    offset += cropped ? 16 : 8;
  }

  return { paletteId, objects };
}

function parseObject(payload: Buffer, objects: Map<number, ObjectBuffer>, generation: number): void {
  if (payload.length < 4) {
    return;
  }

  const objectId = payload.readUInt16BE(0);
  const version = payload[2];
  const sequenceFlags = payload[3];
  const isFirst = (sequenceFlags & 0x80) !== 0;
  const isLast = (sequenceFlags & 0x40) !== 0;
  let offset = 4;
  let object = objects.get(objectId);

  if (isFirst) {
    if (payload.length < 11) {
      return;
    }
    object = {
      width: payload.readUInt16BE(7),
      height: payload.readUInt16BE(9),
      chunks: [],
      version,
      generation
    };
    objects.set(objectId, object);
    offset = 11;
  }

  if (!object) {
    object = { chunks: [], version, generation };
    objects.set(objectId, object);
  }

  object.chunks.push(payload.subarray(offset));

  if (isLast) {
    objects.set(objectId, object);
  }
}

function compositionSignature(composition: PresentationComposition, objects: Map<number, ObjectBuffer>): string {
  return composition.objects
    .map((reference) => {
      const object = objects.get(reference.objectId);
      const crop = reference.crop
        ? `${reference.crop.x},${reference.crop.y},${reference.crop.width},${reference.crop.height}`
        : "full";
      return `${reference.objectId}:${object?.version ?? -1}:${object?.generation ?? -1}:${reference.x},${reference.y}:${crop}`;
    })
    .join("|");
}

function renderComposition(
  composition: PresentationComposition,
  objects: Map<number, ObjectBuffer>,
  palettes: Map<number, Map<number, PaletteEntry>>
): Omit<PgsBitmapCue, "id" | "startMs" | "endMs"> | undefined {
  const palette = palettes.get(composition.paletteId) ?? palettes.values().next().value;
  if (!palette) {
    return undefined;
  }

  const renderable = composition.objects.flatMap((reference) => {
    const object = objects.get(reference.objectId);
    if (!object?.width || !object.height || object.chunks.length === 0) {
      return [];
    }
    const crop = reference.crop ?? { x: 0, y: 0, width: object.width, height: object.height };
    const sourceX = Math.max(0, Math.min(object.width, crop.x));
    const sourceY = Math.max(0, Math.min(object.height, crop.y));
    const width = Math.max(0, Math.min(crop.width, object.width - sourceX));
    const height = Math.max(0, Math.min(crop.height, object.height - sourceY));
    return width > 0 && height > 0 ? [{ reference, object, sourceX, sourceY, width, height }] : [];
  });

  if (renderable.length === 0) {
    return undefined;
  }

  const minX = Math.min(...renderable.map((item) => item.reference.x));
  const minY = Math.min(...renderable.map((item) => item.reference.y));
  const maxX = Math.max(...renderable.map((item) => item.reference.x + item.width));
  const maxY = Math.max(...renderable.map((item) => item.reference.y + item.height));
  const width = maxX - minX;
  const height = maxY - minY;
  const rgba = new Uint8Array(width * height * 4);

  for (const item of renderable) {
    const decoded = decodePgsRle(Buffer.concat(item.object.chunks), item.object.width!, item.object.height!, palette);
    for (let y = 0; y < item.height; y += 1) {
      for (let x = 0; x < item.width; x += 1) {
        const sourceOffset = ((item.sourceY + y) * item.object.width! + item.sourceX + x) * 4;
        const targetX = item.reference.x - minX + x;
        const targetY = item.reference.y - minY + y;
        const targetOffset = (targetY * width + targetX) * 4;
        blendPixel(rgba, targetOffset, decoded, sourceOffset);
      }
    }
  }

  if (!hasVisiblePixels(rgba)) {
    return undefined;
  }
  return { width, height, x: minX, y: minY, rgba };
}

function blendPixel(target: Uint8Array, targetOffset: number, source: Uint8Array, sourceOffset: number): void {
  const sourceAlpha = source[sourceOffset + 3] / 255;
  if (sourceAlpha <= 0) {
    return;
  }
  const targetAlpha = target[targetOffset + 3] / 255;
  const outputAlpha = sourceAlpha + targetAlpha * (1 - sourceAlpha);
  for (let channel = 0; channel < 3; channel += 1) {
    target[targetOffset + channel] = Math.round(
      (source[sourceOffset + channel] * sourceAlpha + target[targetOffset + channel] * targetAlpha * (1 - sourceAlpha)) /
        outputAlpha
    );
  }
  target[targetOffset + 3] = Math.round(outputAlpha * 255);
}

function yCbCrToRgba(color: PaletteEntry): [number, number, number, number] {
  const red = clamp(color.y + 1.402 * (color.cr - 128));
  const green = clamp(color.y - 0.344136 * (color.cb - 128) - 0.714136 * (color.cr - 128));
  const blue = clamp(color.y + 1.772 * (color.cb - 128));
  return [red, green, blue, color.alpha];
}

function clamp(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function hasVisiblePixels(rgba: Uint8Array): boolean {
  for (let offset = 3; offset < rgba.length; offset += 4) {
    if (rgba[offset] > 0) {
      return true;
    }
  }
  return false;
}
