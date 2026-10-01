const { copyFile, mkdir } = require("node:fs/promises");
const { dirname, resolve } = require("node:path");
const { app } = require("electron");

const requiredEnvironmentVariables = ["EVALUATION_VIDEO_PATH", "EVALUATION_OUTPUT_PATH"];
for (const name of requiredEnvironmentVariables) {
  if (!process.env[name]) {
    throw new Error(`${name} is required.`);
  }
}

const userDataPath = process.env.EVALUATION_USER_DATA_PATH
  ?? resolve(process.env.APPDATA, "bulgarian-subtitle-translator");
app.setPath("userData", userDataPath);

app.whenReady().then(async () => {
  const { SettingsService } = require("../dist-electron/main/settingsService.js");
  const { TranslationManager } = require("../dist-electron/main/translationManager.js");

  const settingsService = new SettingsService();
  const settings = await settingsService.getSettings();
  settings.providerId = "gemini";
  settings.quality = process.env.EVALUATION_QUALITY ?? "balanced";
  settings.contextMode = process.env.EVALUATION_CONTEXT_MODE ?? "auto";
  settings.gemini.modelId = process.env.EVALUATION_MODEL_ID ?? "gemini-3.1-flash-lite";
  settings.gemini.thinkingLevel = process.env.EVALUATION_THINKING_LEVEL ?? "medium";
  settings.gemini.temperature = Number(process.env.EVALUATION_TEMPERATURE ?? 0.1);
  settings.gemini.maxOutputTokens = Number(process.env.EVALUATION_MAX_OUTPUT_TOKENS ?? 8192);
  settings.outputConflictMode = "versioned";

  const track = {
    index: Number(process.env.EVALUATION_TRACK_INDEX ?? 4),
    codecName: process.env.EVALUATION_TRACK_CODEC ?? "subrip",
    codecType: "subtitle",
    language: process.env.EVALUATION_TRACK_LANGUAGE ?? "eng",
    title: process.env.EVALUATION_TRACK_TITLE ?? "English",
    isSupported: true,
    isTextBased: true,
    isImageBased: false,
    requiresOcr: false,
    supportedFormat: "srt"
  };

  const manager = new TranslationManager(settingsService);
  const result = await manager.translate(
    {
      videoPath: resolve(process.env.EVALUATION_VIDEO_PATH),
      track,
      settings,
      sampleMode: "none"
    },
    (progress) => {
      process.stdout.write(`${JSON.stringify({ type: "progress", ...progress })}\n`);
    }
  );

  const evaluationOutputPath = resolve(process.env.EVALUATION_OUTPUT_PATH);
  await mkdir(dirname(evaluationOutputPath), { recursive: true });
  await copyFile(result.outputPath, evaluationOutputPath);
  process.stdout.write(`${JSON.stringify({
    type: "result",
    ...result,
    evaluationOutputPath
  })}\n`);
}).then(
  () => app.quit(),
  (error) => {
    process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    app.exit(1);
  }
);
