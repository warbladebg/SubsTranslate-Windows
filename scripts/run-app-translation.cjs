const { app } = require("electron");
const { join } = require("node:path");

async function main() {
  const [videoPath, trackIndexText] = process.argv.slice(2);
  if (!videoPath) {
    throw new Error("Usage: electron scripts/run-app-translation.cjs <video> [track-index]");
  }

  app.setName("bulgarian-subtitle-translator");
  app.setPath("userData", join(process.env.APPDATA, "bulgarian-subtitle-translator"));
  await app.whenReady();

  const { probeVideo } = require("../dist-electron/main/ffprobeService.js");
  const { SettingsService } = require("../dist-electron/main/settingsService.js");
  const { TranslationManager } = require("../dist-electron/main/translationManager.js");

  const probe = await probeVideo(videoPath);
  const requestedTrackIndex = trackIndexText === undefined ? undefined : Number(trackIndexText);
  const track =
    probe.subtitleTracks.find((candidate) => candidate.index === requestedTrackIndex) ??
    probe.subtitleTracks.find((candidate) => candidate.isSupported && /^(eng|en)$/i.test(candidate.language)) ??
    probe.subtitleTracks.find((candidate) => candidate.isSupported && /english/i.test(candidate.title)) ??
    probe.subtitleTracks.find((candidate) => candidate.isSupported);
  if (!track) {
    throw new Error("No supported subtitle track was found.");
  }

  const settingsService = new SettingsService();
  const settings = await settingsService.getSettings();
  const evaluationSettings = {
    ...settings,
    providerId: "gemini",
    quality: "balanced",
    contextMode: "auto",
    outputConflictMode: "versioned",
    gemini: {
      ...settings.gemini,
      modelId: "gemini-3.1-flash-lite",
      thinkingLevel: "minimal",
      temperature: 0.2,
      rateLimitMode: "auto-safe"
    }
  };

  process.stdout.write(
    `Translating ${videoPath}\nTrack ${track.index}: ${track.language} / ${track.codecName} / ${track.title || "untitled"}\n`
  );
  const manager = new TranslationManager(settingsService);
  let lastProgress = "";
  const result = await manager.translate(
    {
      videoPath,
      track,
      settings: evaluationSettings,
      sampleMode: "none"
    },
    (progress) => {
      const summary = `${progress.stage}: ${progress.message}`;
      if (summary !== lastProgress) {
        process.stdout.write(`${summary}\n`);
        lastProgress = summary;
      }
    }
  );

  process.stdout.write(`${JSON.stringify({ track, result }, null, 2)}\n`);
}

main()
  .catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    process.exitCode = 1;
  })
  .finally(() => app.quit());
