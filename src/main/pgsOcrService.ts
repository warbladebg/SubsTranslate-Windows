import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createInterface } from "node:readline";
import { PNG } from "pngjs";
import { createWorker, PSM } from "tesseract.js";
import { parsePgsSup, PgsBitmapCue } from "../core/subtitle/PgsParser";
import { formatSrtTimestamp, SubtitleCue } from "../core/subtitle/SubtitleCue";
import { writeSrt } from "../core/subtitle/SrtWriter";
import { errorMessage } from "../core/util/errors";

interface LocalOcrResult {
  text: string;
  confidence?: number;
}

interface PaddleResult {
  text: string;
  confidence: number;
}

interface PaddleService {
  initialize(): Promise<void>;
  recognize(image: ArrayBuffer, options?: { strategy?: "per-box" | "per-line" | "cross-line" }): Promise<PaddleResult>;
  destroy(): Promise<void>;
}

interface GpuOcrResponse {
  id?: number;
  type?: "ready" | "fatal";
  device?: string;
  error?: string;
  results?: Array<{ text: string; confidence: number }>;
}

type LocalRecognizer = ((image: Buffer, cue: PgsBitmapCue) => Promise<string | LocalOcrResult>) & {
  recognizeCues?: (cues: PgsBitmapCue[], signal?: AbortSignal) => Promise<Array<string | LocalOcrResult>>;
  setPageSegMode?: (mode: PSM) => Promise<void>;
  terminate?: () => Promise<void>;
};

type ThresholdMode = "alpha" | "bright" | "dark" | "solid-alpha";

export interface PgsOcrOptions {
  language?: string;
  signal?: AbortSignal;
  recognizeImage?: LocalRecognizer;
  onProgress?: (progress: PgsOcrProgress) => void;
}

export interface PgsOcrProgress {
  completedImages: number;
  totalImages: number;
  readableCues: number;
}

export async function ocrPgsSupToSrt(supPath: string, options: PgsOcrOptions = {}): Promise<string> {
  const bitmapCues = parsePgsSup(await readFile(supPath));
  if (bitmapCues.length === 0) {
    throw new Error("No visible PGS subtitle images were found in this track.");
  }

  const recognizeImage = options.recognizeImage ?? (await createLocalRecognizer(options.language ?? "eng"));
  const textCues: SubtitleCue[] = [];
  const bitmapCache = new Map<string, string>();
  const appendCue = (bitmapCue: { startMs: number; endMs: number }, text: string): void => {
    textCues.push({
      id: textCues.length + 1,
      originalIndex: textCues.length + 1,
      startTime: formatSrtTimestamp(bitmapCue.startMs),
      endTime: formatSrtTimestamp(bitmapCue.endMs),
      startMs: bitmapCue.startMs,
      endMs: bitmapCue.endMs,
      text
    });
  };

  try {
    options.onProgress?.({ completedImages: 0, totalImages: bitmapCues.length, readableCues: 0 });
    if (recognizeImage.recognizeCues) {
      const batchSize = getGpuBatchSize();
      for (let offset = 0; offset < bitmapCues.length; offset += batchSize) {
        options.signal?.throwIfAborted();
        const sourceBatch = bitmapCues.slice(offset, offset + batchSize);
        const trimmedBatch = sourceBatch.map(trimTransparent);
        const results = await recognizeImage.recognizeCues(trimmedBatch, options.signal);
        if (results.length !== sourceBatch.length) {
          throw new Error(`OCR returned ${results.length}/${sourceBatch.length} expected subtitle cue(s).`);
        }
        for (let batchIndex = 0; batchIndex < sourceBatch.length; batchIndex += 1) {
          const bitmapCue = sourceBatch[batchIndex]!;
          const result = normalizeOcrResult(results[batchIndex]!);
          const text = cleanOcrText(result.text, options.language ?? "eng");
          // The batched recognizer has already applied line-count validation
          // and CPU fallback. Preserve any readable fallback text here rather
          // than turning an imperfect result into a missing subtitle cue.
          if (text) {
            appendCue(bitmapCue, text);
          }
          reportOcrProgress(options, offset + batchIndex + 1, bitmapCues.length, textCues.length);
        }
      }
    } else {
      for (const [index, bitmapCue] of bitmapCues.entries()) {
        options.signal?.throwIfAborted();
        const trimmedCue = trimTransparent(bitmapCue);
        const bitmapKey = hashCueBitmap(trimmedCue);
        // Repeated subtitle images ("...", sound cues) are recognised once.
        const text = bitmapCache.get(bitmapKey)
          ?? (await recognizeCueText(recognizeImage, trimmedCue, options.signal, options.language ?? "eng"));
        if (text) {
          bitmapCache.set(bitmapKey, text);
          appendCue(bitmapCue, text);
        }
        reportOcrProgress(options, index + 1, bitmapCues.length, textCues.length);
      }
    }
  } finally {
    if (!options.recognizeImage && recognizeImage.terminate) {
      await recognizeImage.terminate();
    }
  }

  if (textCues.length === 0) {
    throw new Error(
      `PGS OCR found ${bitmapCues.length} subtitle image(s), but did not detect any readable subtitle text. ` +
        "Try another subtitle language track if available."
    );
  }

  // PGS line placement carries meaning (especially two-speaker dialogue).
  // Preserve OCR line segmentation instead of applying generic SRT reflow.
  return writeSrt(textCues, { rewrap: false });
}

async function createLocalRecognizer(language: string): Promise<LocalRecognizer> {
  const requestedEngine =
    process.env.SUBS_TRANSLATE_OCR_ENGINE?.toLocaleLowerCase() ??
    (hasGpuSidecarResources()
      ? "gpu"
      : hasBundledTesseractLanguage(language)
        ? "tesseract"
        : "paddle");

  if (requestedEngine === "gpu") {
    let gpu: LocalRecognizer | undefined;
    let gpuError: unknown;
    try {
      gpu = await createGpuPaddleRecognizer();
    } catch (error) {
      gpuError = error;
    }
    const tesseract = hasBundledTesseractLanguage(language)
      ? await createTesseractRecognizer(language)
      : undefined;
    if (!gpu) {
      if (tesseract) {
        return tesseract;
      }
      throw new Error(
        `GPU OCR could not start and no local fallback is available. ${errorMessage(gpuError)}`
      );
    }
    if (!tesseract) {
      return gpu;
    }

    const recognize = (async (image: Buffer, cue: PgsBitmapCue): Promise<LocalOcrResult> => {
      let gpuResult: LocalOcrResult;
      try {
        gpuResult = normalizeOcrResult(await gpu!(image, cue));
      } catch {
        // A CUDA/runtime failure must not turn into a missing subtitle cue.
        return normalizeOcrResult(await tesseract(image, cue));
      }
      const gpuText = cleanOcrText(gpuResult.text, language);
      if (
        (gpuResult.confidence ?? 0) >= getGpuAcceptanceConfidence() &&
        isPlausibleOcrText(gpuText) &&
        countOcrLines(gpuText) >= estimateBitmapLineCount(cue)
      ) {
        return gpuResult;
      }
      return normalizeOcrResult(await tesseract(image, cue));
    }) as LocalRecognizer;
    if (gpu.recognizeCues) {
      recognize.recognizeCues = async (cues, signal) => {
        let gpuResults: Array<string | LocalOcrResult>;
        try {
          gpuResults = await gpu!.recognizeCues!(cues, signal);
          if (gpuResults.length !== cues.length) {
            throw new Error(`GPU OCR returned ${gpuResults.length}/${cues.length} expected cue(s).`);
          }
        } catch {
          gpuResults = cues.map(() => ({ text: "", confidence: 0 }));
        }

        const accepted: LocalOcrResult[] = [];
        for (let index = 0; index < cues.length; index += 1) {
          signal?.throwIfAborted();
          const cue = cues[index]!;
          const gpuResult = normalizeOcrResult(gpuResults[index]!);
          const gpuText = cleanOcrText(gpuResult.text, language);
          if (
            (gpuResult.confidence ?? 0) >= getGpuAcceptanceConfidence() &&
            isPlausibleOcrText(gpuText) &&
            countOcrLines(gpuText) >= estimateBitmapLineCount(cue)
          ) {
            accepted.push(gpuResult);
          } else {
            accepted.push({ text: await recognizeCueText(tesseract, cue, signal, language) });
          }
        }
        return accepted;
      };
    }
    recognize.setPageSegMode = (mode: PSM) => tesseract.setPageSegMode?.(mode) ?? Promise.resolve();
    recognize.terminate = async () => {
      await Promise.all([gpu!.terminate?.(), tesseract.terminate?.()]);
    };
    return recognize;
  }

  let paddle: LocalRecognizer | undefined;
  let tesseract: LocalRecognizer | undefined;
  let paddleError: unknown;

  if (requestedEngine !== "tesseract") {
    try {
      paddle = await createPaddleRecognizer();
    } catch (error) {
      paddleError = error;
    }
  }

  if (requestedEngine !== "paddle" && hasBundledTesseractLanguage(language)) {
    tesseract = await createTesseractRecognizer(language);
  }

  if (!paddle && !tesseract) {
    throw new Error(
      `No fully local OCR engine is available. ${paddleError instanceof Error ? paddleError.message : "PaddleOCR models are missing."}`
    );
  }
  if (!paddle) {
    return tesseract!;
  }
  if (!tesseract) {
    return paddle;
  }

  const recognize = (async (image: Buffer, cue: PgsBitmapCue): Promise<LocalOcrResult> => {
    const tesseractResult = normalizeOcrResult(await tesseract!(image, cue));
    const tesseractText = cleanOcrText(tesseractResult.text, language);
    if (
      (tesseractResult.confidence ?? 0) >= 50 &&
      isPlausibleOcrText(tesseractText) &&
      countOcrLines(tesseractText) >= estimateBitmapLineCount(cue)
    ) {
      return tesseractResult;
    }

    const paddleResult = normalizeOcrResult(await paddle!(image, cue));
    return chooseEngineResult(paddleResult, tesseractResult);
  }) as LocalRecognizer;
  recognize.setPageSegMode = (mode: PSM) => tesseract!.setPageSegMode?.(mode) ?? Promise.resolve();
  recognize.terminate = async () => {
    await Promise.all([paddle!.terminate?.(), tesseract!.terminate?.()]);
  };
  return recognize;
}

function getGpuAcceptanceConfidence(): number {
  const configured = Number(process.env.SUBS_TRANSLATE_GPU_MIN_CONFIDENCE ?? "96");
  return Number.isFinite(configured) ? Math.max(0, Math.min(100, configured)) : 96;
}

function getGpuBatchSize(): number {
  const configured = Number(process.env.SUBS_TRANSLATE_GPU_BATCH_SIZE ?? "32");
  return Number.isInteger(configured) ? Math.max(1, Math.min(128, configured)) : 32;
}

async function createGpuPaddleRecognizer(): Promise<LocalRecognizer> {
  const sidecarDirectory = findGpuSidecarDirectory();
  const pythonPath = resolve(sidecarDirectory, ".venv", "Scripts", "python.exe");
  const scriptPath = resolve(sidecarDirectory, "gpu_ocr_server.py");
  const modelPath = resolve(
    sidecarDirectory,
    "models",
    ".paddlex",
    "official_models",
    "PP-OCRv6_medium_rec"
  );
  for (const path of [pythonPath, scriptPath, modelPath]) {
    if (!existsSync(path)) {
      throw new Error(`GPU OCR sidecar resource is missing: ${path}`);
    }
  }

  const child = spawn(pythonPath, ["-u", scriptPath], {
    cwd: sidecarDirectory,
    windowsHide: true,
    stdio: ["pipe", "pipe", "pipe"],
    env: {
      ...process.env,
      PADDLE_PDX_CACHE_HOME: resolve(sidecarDirectory, "models", ".paddlex"),
      PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK: "True"
    }
  });
  const pending = new Map<number, { resolve: (value: GpuOcrResponse) => void; reject: (error: Error) => void }>();
  const cache = new Map<string, Promise<LocalOcrResult>>();
  let nextId = 1;
  let stderr = "";
  let readyResolve: (() => void) | undefined;
  let readyReject: ((error: Error) => void) | undefined;
  const ready = new Promise<void>((resolveReady, rejectReady) => {
    readyResolve = resolveReady;
    readyReject = rejectReady;
  });
  const timeout = setTimeout(() => readyReject?.(new Error("GPU OCR initialization timed out.")), 60_000);

  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => {
    stderr = `${stderr}${chunk}`.slice(-12_000);
  });
  const lines = createInterface({ input: child.stdout });
  lines.on("line", (line) => {
    let message: GpuOcrResponse;
    try {
      message = JSON.parse(line) as GpuOcrResponse;
    } catch {
      return;
    }
    if (message.type === "ready") {
      clearTimeout(timeout);
      readyResolve?.();
      return;
    }
    if (message.type === "fatal") {
      const error = new Error(message.error ?? "GPU OCR failed to initialize.");
      readyReject?.(error);
      return;
    }
    if (message.id !== undefined) {
      const request = pending.get(message.id);
      if (!request) {
        return;
      }
      pending.delete(message.id);
      if (message.error) {
        request.reject(new Error(message.error));
      } else {
        request.resolve(message);
      }
    }
  });
  child.on("error", (error) => readyReject?.(error));
  child.on("close", (code) => {
    const error = new Error(`GPU OCR sidecar exited with code ${code ?? "unknown"}. ${stderr}`.trim());
    readyReject?.(error);
    for (const request of pending.values()) {
      request.reject(error);
    }
    pending.clear();
  });
  try {
    await ready;
  } catch (error) {
    clearTimeout(timeout);
    lines.close();
    child.stdin.end();
    if (child.exitCode === null) {
      child.kill();
    }
    throw error;
  }

  const recognizeCues = async (cues: PgsBitmapCue[], signal?: AbortSignal): Promise<LocalOcrResult[]> => {
    const cueImages = cues.map(createGpuLineImages);
    const images = cueImages.flat();
    signal?.throwIfAborted();
      const id = nextId++;
      const response = await new Promise<GpuOcrResponse>((resolveResponse, rejectResponse) => {
        pending.set(id, { resolve: resolveResponse, reject: rejectResponse });
        child.stdin.write(`${JSON.stringify({ id, images: images.map((image) => image.toString("base64")) })}\n`, (error) => {
          if (error) {
            pending.delete(id);
            rejectResponse(error);
          }
        });
      });
      const results = response.results ?? [];
      if (results.length !== images.length) {
        throw new Error(`GPU OCR returned ${results.length}/${images.length} expected subtitle line(s).`);
      }
    let resultOffset = 0;
    return cueImages.map((linesForCue) => {
      const cueResults = results.slice(resultOffset, resultOffset + linesForCue.length);
      resultOffset += linesForCue.length;
      return {
        text: cueResults.map((result) => result.text.trim()).join("\n"),
        confidence: Math.min(...cueResults.map((result) => result.confidence * 100))
      };
    });
  };
  const recognize = (async (_image: Buffer, cue: PgsBitmapCue): Promise<LocalOcrResult> => {
    const key = hashCueBitmap(cue);
    const cached = cache.get(key);
    if (cached) {
      return cached;
    }
    const task = recognizeCues([cue]).then((results) => results[0]!);
    cache.set(key, task);
    return task;
  }) as LocalRecognizer;
  recognize.recognizeCues = recognizeCues;
  recognize.terminate = async () => {
    lines.close();
    child.stdin.end();
    if (child.exitCode === null) {
      child.kill();
    }
  };
  return recognize;
}

async function createPaddleRecognizer(): Promise<LocalRecognizer> {
  const modelDirectory = findPaddleModelDirectory();
  // PGS captions are already tightly cropped, high-contrast text. The tiny
  // detector is substantially faster here; keep the medium recognizer where
  // character accuracy is actually decided.
  const detection = resolve(modelDirectory, "PP-OCRv6_tiny_det.ort");
  const recognition = resolve(modelDirectory, "PP-OCRv6_medium_rec.ort");
  const charactersDictionary = resolve(modelDirectory, "ppocrv6_dict.txt");
  for (const path of [detection, recognition, charactersDictionary]) {
    if (!existsSync(path)) {
      throw new Error(`Bundled PaddleOCR model is missing: ${path}`);
    }
  }

  // The Electron main process is CommonJS while ppu-paddle-ocr is ESM-only.
  // Preserve a native dynamic import instead of letting TypeScript emit require().
  const dynamicImport = new Function("specifier", "return import(specifier)") as (
    specifier: string
  ) => Promise<{ PaddleOcrService: new (options: unknown) => PaddleService }>;
  const { PaddleOcrService } = await dynamicImport("ppu-paddle-ocr");
  const service = new PaddleOcrService({
    model: { detection, recognition, charactersDictionary },
    detection: { maxSideLength: 1280, minimumAreaThreshold: 20, paddingVertical: 0.15, paddingHorizontal: 0.12 },
    recognition: { strategy: "per-line", imageHeight: 48 },
    session: { executionProviders: ["cpu"], graphOptimizationLevel: "all" },
    processing: { engine: "opencv" },
    debugging: { debug: false, verbose: false }
  });
  await service.initialize();

  const recognize = (async (_image: Buffer, cue: PgsBitmapCue): Promise<LocalOcrResult> => {
    // Paddle's detector benefits from the native PGS resolution. Upscaling is
    // reserved for Tesseract and would make ONNX detection needlessly costly.
    const nativeImage = compositeCueToPng(cue, 1, 0);
    const arrayBuffer = nativeImage.buffer.slice(nativeImage.byteOffset, nativeImage.byteOffset + nativeImage.byteLength) as ArrayBuffer;
    const result = await service.recognize(arrayBuffer, { strategy: "per-line" });
    return { text: result.text, confidence: result.confidence * 100 };
  }) as LocalRecognizer;
  recognize.terminate = () => service.destroy();
  return recognize;
}

function reportOcrProgress(
  options: PgsOcrOptions,
  completedImages: number,
  totalImages: number,
  readableCues: number
): void {
  if (completedImages === totalImages || completedImages === 1 || completedImages % 10 === 0) {
    options.onProgress?.({ completedImages, totalImages, readableCues });
  }
}

async function createTesseractRecognizer(language: string): Promise<LocalRecognizer> {
  const worker = await createWorker(language, 1, {
    langPath: findTesseractDataDirectory(),
    gzip: false,
    logger: () => undefined
  });

  const recognize = (async (image: Buffer): Promise<LocalOcrResult> => {
    const result = await worker.recognize(image);
    return {
      text: result.data.text,
      confidence: result.data.confidence
    };
  }) as LocalRecognizer;
  recognize.setPageSegMode = async (mode: PSM) => {
    await worker.setParameters({
      tessedit_pageseg_mode: mode,
      preserve_interword_spaces: "1",
      user_defined_dpi: "300"
    });
  };
  recognize.terminate = async () => {
    await worker.terminate();
  };
  await recognize.setPageSegMode(PSM.SPARSE_TEXT);
  return recognize;
}

async function recognizeCueText(
  recognizeImage: LocalRecognizer,
  cue: PgsBitmapCue,
  signal?: AbortSignal,
  language = "eng"
): Promise<string> {
  const attempts = createOcrAttempts(cue);
  const expectedLines = estimateBitmapLineCount(cue);
  const candidates: Array<{ text: string; confidence?: number; score: number }> = [];

  for (const attempt of attempts) {
    if (attempt.psm && recognizeImage.setPageSegMode) {
      await recognizeImage.setPageSegMode(attempt.psm);
    }

    for (const image of attempt.images) {
      signal?.throwIfAborted();
      const result = normalizeOcrResult(await recognizeImage(image, cue));
      const text = cleanOcrText(result.text, language);
      const missingLinePenalty = Math.max(0, expectedLines - countOcrLines(text)) * 25;
      const score = scoreOcrText(text, result.confidence) - missingLinePenalty;
      if (text) {
        candidates.push({ text, confidence: result.confidence, score });
      }
      if (isHighConfidenceResult(text, result.confidence, score, expectedLines)) {
        if (process.env.SUBS_TRANSLATE_OCR_DEBUG === "1") {
          console.error(JSON.stringify({ startMs: cue.startMs, selected: text, early: true, candidates }));
        }
        return text;
      }
    }
  }

  const consensus = new Map<string, number>();
  for (const candidate of candidates) {
    const key = consensusKey(candidate.text);
    consensus.set(key, (consensus.get(key) ?? 0) + 1);
  }
  const best = candidates
    .map((candidate) => ({
      ...candidate,
      // Repeated preprocessing variants are correlated evidence. Let them
      // break near-ties, but never overpower a materially higher-confidence
      // reading from a cleaner image.
      consensusScore: candidate.score + Math.max(0, (consensus.get(consensusKey(candidate.text)) ?? 1) - 1) * 0.5
    }))
    .sort((left, right) => right.consensusScore - left.consensusScore)[0];
  if (process.env.SUBS_TRANSLATE_OCR_DEBUG === "1") {
    console.error(JSON.stringify({ startMs: cue.startMs, selected: best?.text ?? "", early: false, candidates }));
  }
  return best && best.consensusScore >= 20 && isPlausibleOcrText(best.text) ? best.text : "";
}

function createOcrAttempts(cue: PgsBitmapCue): Array<{ psm: PSM; images: Buffer[] }> {
  const scale = getOcrScale(cue);
  const blackBackground = compositeCueToPng(cue, scale, 0);
  const whiteBackground = compositeCueToPng(cue, scale, 255);
  const solidAlpha = thresholdCueToPng(cue, scale, "solid-alpha");
  const brightText = thresholdCueToPng(cue, scale, "bright");
  const alphaMask = thresholdCueToPng(cue, scale, "alpha");
  const darkText = thresholdCueToPng(cue, scale, "dark");
  const likelySingleLine = cue.height <= 75;
  const primary = likelySingleLine ? PSM.SINGLE_LINE : PSM.SINGLE_BLOCK;
  const secondary = likelySingleLine ? PSM.SINGLE_BLOCK : PSM.SPARSE_TEXT;

  return [
    { psm: primary, images: [blackBackground] },
    { psm: secondary, images: [blackBackground] },
    { psm: primary, images: [solidAlpha, whiteBackground] },
    { psm: secondary, images: [brightText, alphaMask] },
    { psm: PSM.AUTO, images: [darkText] }
  ];
}

function getOcrScale(cue: PgsBitmapCue): number {
  const desiredScale = cue.height < 70 ? 4 : cue.height < 120 ? 3 : 2;
  const maxScaleByWidth = Math.max(1, Math.floor(3600 / Math.max(1, cue.width)));
  return Math.max(1, Math.min(desiredScale, maxScaleByWidth));
}

function thresholdCueToPng(cue: PgsBitmapCue, scale: number, mode: ThresholdMode): Buffer {
  const png = new PNG({ width: cue.width * scale, height: cue.height * scale });
  drawThresholdCue(png, cue, scale, 0, 0, mode);
  return PNG.sync.write(png);
}

function drawThresholdCue(
  png: PNG,
  cue: PgsBitmapCue,
  scale: number,
  offsetX: number,
  offsetY: number,
  mode: ThresholdMode
): void {
  for (let y = 0; y < cue.height * scale; y += 1) {
    for (let x = 0; x < cue.width * scale; x += 1) {
      const sourceX = Math.floor(x / scale);
      const sourceY = Math.floor(y / scale);
      const isInk = isThresholdInk(cue, sourceX, sourceY, mode);
      const color = isInk ? 0 : 255;
      const outputOffset = ((offsetY + y) * png.width + offsetX + x) * 4;
      png.data[outputOffset] = color;
      png.data[outputOffset + 1] = color;
      png.data[outputOffset + 2] = color;
      png.data[outputOffset + 3] = 255;
    }
  }
}

function isThresholdInk(cue: PgsBitmapCue, x: number, y: number, mode: ThresholdMode): boolean {
  if (mode === "solid-alpha") {
    return hasNearbyAlpha(cue, x, y, 2);
  }

  const offset = (y * cue.width + x) * 4;
  const alpha = cue.rgba[offset + 3];
  const luminance = getLuminance(cue.rgba[offset], cue.rgba[offset + 1], cue.rgba[offset + 2]);
  return alpha > 24 && (mode === "alpha" || (mode === "bright" && luminance >= 120) || (mode === "dark" && luminance < 150));
}

function hasNearbyAlpha(cue: PgsBitmapCue, x: number, y: number, radius: number): boolean {
  const minY = Math.max(0, y - radius);
  const maxY = Math.min(cue.height - 1, y + radius);
  for (let testY = minY; testY <= maxY; testY += 1) {
    if (cue.rgba[(testY * cue.width + x) * 4 + 3] > 24) {
      return true;
    }
  }
  return false;
}

function compositeCueToPng(cue: PgsBitmapCue, scale: number, background: number): Buffer {
  const png = new PNG({ width: cue.width * scale, height: cue.height * scale });
  drawCompositeCue(png, cue, scale, 0, 0, background);
  return PNG.sync.write(png);
}

function drawCompositeCue(png: PNG, cue: PgsBitmapCue, scale: number, offsetX: number, offsetY: number, background: number): void {
  for (let y = 0; y < cue.height * scale; y += 1) {
    for (let x = 0; x < cue.width * scale; x += 1) {
      const sourceX = Math.floor(x / scale);
      const sourceY = Math.floor(y / scale);
      const sourceOffset = (sourceY * cue.width + sourceX) * 4;
      const alpha = cue.rgba[sourceOffset + 3] / 255;
      const outputOffset = ((offsetY + y) * png.width + offsetX + x) * 4;
      png.data[outputOffset] = compositeChannel(cue.rgba[sourceOffset], background, alpha);
      png.data[outputOffset + 1] = compositeChannel(cue.rgba[sourceOffset + 1], background, alpha);
      png.data[outputOffset + 2] = compositeChannel(cue.rgba[sourceOffset + 2], background, alpha);
      png.data[outputOffset + 3] = 255;
    }
  }
}

function compositeChannel(foreground: number, background: number, alpha: number): number {
  return Math.round(foreground * alpha + background * (1 - alpha));
}

function getLuminance(red: number, green: number, blue: number): number {
  return red * 0.299 + green * 0.587 + blue * 0.114;
}

function normalizeOcrResult(result: string | LocalOcrResult): LocalOcrResult {
  return typeof result === "string" ? { text: result } : result;
}

function scoreOcrText(text: string, confidence?: number): number {
  if (!text) {
    return 0;
  }

  const letters = text.match(/\p{L}/gu)?.length ?? 0;
  const numbers = text.match(/\p{N}/gu)?.length ?? 0;
  const words = text.match(/[\p{L}\p{N}]{2,}/gu)?.length ?? 0;
  const junk = text.match(/[=_~¥|\\]{1,}/g)?.length ?? 0;
  const repeatedPunctuation = text.match(/([^\p{L}\p{N}\s])\1{2,}/gu)?.length ?? 0;
  const confidenceScore = confidence === undefined ? 25 : Math.max(0, Math.min(100, confidence)) * 0.8;
  const contentScore = Math.min(12, letters * 0.5) + Math.min(4, numbers) + Math.min(8, words * 2);
  return confidenceScore + contentScore - junk * 8 - repeatedPunctuation * 10;
}

function isHighConfidenceResult(
  text: string,
  confidence: number | undefined,
  score: number,
  expectedLines: number
): boolean {
  if (process.env.SUBS_TRANSLATE_OCR_EXHAUSTIVE === "1") {
    return false;
  }
  if (!isPlausibleOcrText(text)) {
    return false;
  }
  if (countOcrLines(text) < expectedLines) {
    return false;
  }
  if (confidence === undefined) {
    return score >= 28;
  }
  return confidence >= 94.5 && score >= 69;
}

function countOcrLines(text: string): number {
  return text ? text.split(/\n+/).filter((line) => line.trim()).length : 0;
}

function estimateBitmapLineCount(cue: PgsBitmapCue): number {
  return Math.max(1, Math.min(3, findBitmapLineBands(cue).length));
}

function findBitmapLineBands(cue: PgsBitmapCue): Array<{ minY: number; maxY: number }> {
  const activeRows: boolean[] = [];
  const minimumInk = Math.max(1, Math.floor(cue.width * 0.002));
  for (let y = 0; y < cue.height; y += 1) {
    let ink = 0;
    for (let x = 0; x < cue.width; x += 1) {
      if (cue.rgba[(y * cue.width + x) * 4 + 3] > 24) {
        ink += 1;
      }
    }
    activeRows.push(ink >= minimumInk);
  }

  // Bridge tiny antialiasing/diacritic gaps within one text line.
  for (let y = 1; y < activeRows.length - 1; y += 1) {
    if (!activeRows[y] && activeRows[y - 1] && activeRows[y + 1]) {
      activeRows[y] = true;
    }
  }

  const bands: Array<{ minY: number; maxY: number }> = [];
  let insideLine = false;
  let minY = 0;
  for (let y = 0; y < activeRows.length; y += 1) {
    const active = activeRows[y];
    if (active && !insideLine) {
      minY = y;
    }
    if (!active && insideLine) {
      bands.push({ minY, maxY: y - 1 });
    }
    insideLine = active;
  }
  if (insideLine) {
    bands.push({ minY, maxY: cue.height - 1 });
  }
  return bands.length > 0 ? bands : [{ minY: 0, maxY: cue.height - 1 }];
}

function createGpuLineImages(cue: PgsBitmapCue): Buffer[] {
  const bands = findBitmapLineBands(cue);
  // An implausible segmentation must never discard text. Let the recognizer
  // see the complete cue and force confidence/line validation to decide.
  if (bands.length > 3) {
    return [compositeCueToPng(cue, 1, 0)];
  }
  return bands.map((band) => {
    const paddingY = 4;
    const minY = Math.max(0, band.minY - paddingY);
    const maxY = Math.min(cue.height - 1, band.maxY + paddingY);
    let minX = cue.width;
    let maxX = -1;
    for (let y = minY; y <= maxY; y += 1) {
      for (let x = 0; x < cue.width; x += 1) {
        if (cue.rgba[(y * cue.width + x) * 4 + 3] > 0) {
          minX = Math.min(minX, x);
          maxX = Math.max(maxX, x);
        }
      }
    }
    if (maxX < minX) {
      return compositeCueToPng(cue, 1, 0);
    }
    const paddingX = 8;
    minX = Math.max(0, minX - paddingX);
    maxX = Math.min(cue.width - 1, maxX + paddingX);
    return compositeCueToPng(cropCueRegion(cue, minX, minY, maxX, maxY), 1, 0);
  });
}

function cropCueRegion(
  cue: PgsBitmapCue,
  minX: number,
  minY: number,
  maxX: number,
  maxY: number
): PgsBitmapCue {
  const width = maxX - minX + 1;
  const height = maxY - minY + 1;
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    const sourceStart = ((minY + y) * cue.width + minX) * 4;
    rgba.set(cue.rgba.subarray(sourceStart, sourceStart + width * 4), y * width * 4);
  }
  return { ...cue, width, height, x: cue.x + minX, y: cue.y + minY, rgba };
}

function trimTransparent(cue: PgsBitmapCue): PgsBitmapCue {
  let minX = cue.width;
  let minY = cue.height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < cue.height; y += 1) {
    for (let x = 0; x < cue.width; x += 1) {
      const alpha = cue.rgba[(y * cue.width + x) * 4 + 3];
      if (alpha > 0) {
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }
  }

  if (maxX < minX || maxY < minY) {
    return cue;
  }

  const padding = 8;
  minX = Math.max(0, minX - padding);
  minY = Math.max(0, minY - padding);
  maxX = Math.min(cue.width - 1, maxX + padding);
  maxY = Math.min(cue.height - 1, maxY + padding);
  const width = maxX - minX + 1;
  const height = maxY - minY + 1;
  const rgba = new Uint8Array(width * height * 4);

  for (let y = 0; y < height; y += 1) {
    const sourceStart = ((minY + y) * cue.width + minX) * 4;
    const sourceEnd = sourceStart + width * 4;
    rgba.set(cue.rgba.subarray(sourceStart, sourceEnd), y * width * 4);
  }

  return {
    ...cue,
    width,
    height,
    x: cue.x + minX,
    y: cue.y + minY,
    rgba
  };
}

function cleanOcrText(text: string, language?: string): string {
  const lines = text
    .replace(/[|]/g, "I")
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);

  const cleaned = dedupeAdjacentLines(lines).join("\n").trim();
  return /^(?:eng|en)$/i.test(language ?? "") ? fixEnglishOcrCase(cleaned) : cleaned;
}

function fixEnglishOcrCase(text: string): string {
  // Tesseract can confuse lowercase i with uppercase I in a small set of
  // common words. Correct only unmistakable mid-sentence function words;
  // preserve line starts, acronyms, proper names, and the pronoun "I".
  return text
    .replace(
      /(?<=[\p{L}\p{N},;:'"])([ \n])(Into|It|Is|If|In)\b/gu,
      (_match, separator: string, word: string) => `${separator}${word.toLowerCase()}`
    )
    .replace(/(^|\n)l've\b/gu, "$1I've");
}

function dedupeAdjacentLines(lines: string[]): string[] {
  const deduped: string[] = [];
  for (const line of lines) {
    if (deduped[deduped.length - 1]?.toLocaleLowerCase() === line.toLocaleLowerCase()) {
      continue;
    }
    deduped.push(line);
  }
  return deduped;
}

function chooseEngineResult(left: LocalOcrResult, right: LocalOcrResult): LocalOcrResult {
  const leftText = cleanOcrText(left.text);
  const rightText = cleanOcrText(right.text);
  if (!leftText) {
    return right;
  }
  if (!rightText) {
    return left;
  }

  const leftScore = scoreOcrText(leftText, left.confidence);
  const rightScore = scoreOcrText(rightText, right.confidence);
  if (lexicalKey(leftText) === lexicalKey(rightText)) {
    const confidenceGap = Math.abs((left.confidence ?? 0) - (right.confidence ?? 0));
    if (confidenceGap <= 5) {
      return leftText.length >= rightText.length ? left : right;
    }
  }
  if (consensusKey(leftText) === consensusKey(rightText)) {
    return leftScore >= rightScore ? left : right;
  }
  return leftScore >= rightScore ? left : right;
}

function lexicalKey(text: string): string {
  return text.normalize("NFKC").toLocaleLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
}

function consensusKey(text: string): string {
  return text
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

function isPlausibleOcrText(text: string): boolean {
  const meaningful = text.match(/[\p{L}\p{N}]/gu)?.length ?? 0;
  const visible = text.match(/\S/gu)?.length ?? 0;
  if (meaningful === 0 || visible === 0) {
    return false;
  }
  const junk = text.match(/[=_~¥|\\]/gu)?.length ?? 0;
  return junk <= Math.max(1, Math.floor(visible * 0.08));
}

function hashCueBitmap(cue: PgsBitmapCue): string {
  return createHash("sha1")
    .update(`${cue.width}x${cue.height}:`)
    .update(cue.rgba)
    .digest("hex");
}

function hasBundledTesseractLanguage(language: string): boolean {
  return existsSync(resolve(findTesseractDataDirectory(), `${language}.traineddata`));
}

function findTesseractDataDirectory(): string {
  const candidates = resourceRoots().map((root) => resolve(root));
  return candidates.find((root) => existsSync(resolve(root, "eng.traineddata"))) ?? candidates[0]!;
}

function findPaddleModelDirectory(): string {
  const configured = process.env.SUBS_TRANSLATE_OCR_MODEL_DIR;
  const candidates = [
    configured,
    ...resourceRoots().map((root) => resolve(root, "sidecars", "models", "ppu-paddle-ocr"))
  ].filter((candidate): candidate is string => Boolean(candidate));
  return candidates.find((candidate) => existsSync(resolve(candidate, "PP-OCRv6_medium_rec.ort"))) ?? candidates[0]!;
}

function findGpuSidecarDirectory(): string {
  const configured = process.env.SUBS_TRANSLATE_GPU_OCR_DIR;
  const candidates = [
    configured,
    ...resourceRoots().map((root) => resolve(root, "sidecars", "paddle-gpu"))
  ].filter((candidate): candidate is string => Boolean(candidate));
  return candidates.find((candidate) => existsSync(resolve(candidate, "gpu_ocr_server.py"))) ?? candidates[0]!;
}

function hasGpuSidecarResources(): boolean {
  const directory = findGpuSidecarDirectory();
  return [
    resolve(directory, ".venv", "Scripts", "python.exe"),
    resolve(directory, "gpu_ocr_server.py"),
    resolve(directory, "models", ".paddlex", "official_models", "PP-OCRv6_medium_rec")
  ].every((path) => existsSync(path));
}

function resourceRoots(): string[] {
  const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
  return [
    process.cwd(),
    resolve(__dirname, "..", ".."),
    ...(resourcesPath ? [resourcesPath] : [])
  ];
}
