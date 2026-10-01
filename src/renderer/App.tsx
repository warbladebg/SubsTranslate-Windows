import { lazy, Suspense, useEffect, useLayoutEffect, useState } from "react";
import { flushSync } from "react-dom";
import { Loader2 } from "lucide-react";
import { AppSidebar, type AppPage, type AppTheme } from "./components/AppSidebar";
import { DiscoverPage } from "./components/DiscoverPage";
import { TranslatePage } from "./components/translate/TranslatePage";
import { useTranslationWorkspace } from "./components/translate/useTranslationWorkspace";
import type { MediaToolsLaunchRequest } from "./components/MediaToolsPage";
import { DownloadProgressMonitor } from "./components/DownloadProgressMonitor";
import type { WorkflowProfile } from "../main/workflowProfileService";
import type { DownloadedWorkflowTarget } from "../core/downloads/DownloadedLibrary";
import { useAppData } from "./hooks/useAppData";
import { useDownloadMonitor } from "./hooks/useDownloadMonitor";
import { useStoredPreference } from "./storage";
import { UI_LANGUAGE_STORAGE_KEY, type UiLanguage } from "./uiLanguage";

const StatsPage = lazy(() => import("./components/StatsPage").then(({ StatsPage }) => ({ default: StatsPage })));
const MediaToolsPage = lazy(() => import("./components/MediaToolsPage").then(({ MediaToolsPage }) => ({ default: MediaToolsPage })));
const DownloadedPage = lazy(() => import("./components/DownloadedPage").then(({ DownloadedPage }) => ({ default: DownloadedPage })));
const appLogoUrl = `${import.meta.env.BASE_URL}app-logo.png`;

const APP_THEME_STORAGE_KEY = "substranslate:theme";

/**
 * Runs a whole-app state change inside a view transition (cross-fade, or the circular
 * theme reveal), falling back to an instant update without support or with reduced motion.
 */
function withViewTransition(kind: "theme" | "language", update: () => void): void {
  const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  if (!document.startViewTransition || reduceMotion) {
    update();
    return;
  }
  const root = document.documentElement;
  root.dataset.transition = kind;
  const transition = document.startViewTransition(() => flushSync(update));
  void transition.finished.finally(() => delete root.dataset.transition);
}
const parseTheme = (stored: string | null): AppTheme => stored === "light" ? "light" : "dark";
const parseUiLanguage = (stored: string | null): UiLanguage => stored === "bg" ? "bg" : "en";

export default function App() {
  const [activePage, setActivePage] = useState<AppPage>("discover");
  const [theme, setTheme] = useStoredPreference(APP_THEME_STORAGE_KEY, parseTheme);
  const [uiLanguage, setUiLanguage] = useStoredPreference(UI_LANGUAGE_STORAGE_KEY, parseUiLanguage);
  // The Media page keeps long-running work in local state, so once opened it stays mounted.
  const [mediaPageMounted, setMediaPageMounted] = useState(false);
  const [mediaLibraryLaunch, setMediaLibraryLaunch] = useState<MediaToolsLaunchRequest>();
  const [translateError, setTranslateError] = useState<string>();

  const appData = useAppData(setTranslateError);
  const { settings, keys, workflowProfiles } = appData;
  const workspace = useTranslationWorkspace({
    settings,
    setSettings: appData.setSettings,
    persistSettings: appData.persistSettings,
    keys,
    workflowProfiles,
    error: translateError,
    setError: setTranslateError
  });
  const downloads = useDownloadMonitor();

  // Layout effects so the attributes are in place inside a view transition's update callback.
  useLayoutEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  useLayoutEffect(() => {
    document.documentElement.lang = uiLanguage;
    document.documentElement.dataset.uiLanguage = uiLanguage;
  }, [uiLanguage]);

  function toggleTheme(origin: { x: number; y: number }): void {
    const root = document.documentElement;
    root.style.setProperty("--reveal-x", `${origin.x}px`);
    root.style.setProperty("--reveal-y", `${origin.y}px`);
    withViewTransition("theme", () => setTheme((current) => current === "dark" ? "light" : "dark"));
  }

  function toggleLanguage(): void {
    withViewTransition("language", () => setUiLanguage((current) => current === "bg" ? "en" : "bg"));
  }

  function navigate(page: AppPage): void {
    if (page === "media") setMediaPageMounted(true);
    setActivePage(page);
  }

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "auto" });
  }, [activePage]);

  async function prepareDownloadedWorkflow(target: DownloadedWorkflowTarget, profile: WorkflowProfile): Promise<void> {
    if (!profile.config.media.enabled) {
      await workspace.prepareDownloadedTranslation(target, profile, () => navigate("translate"));
      return;
    }
    await workspace.prepareMediaProfile(profile);
    setMediaLibraryLaunch({
      id: `${Date.now()}-${profile.id}-${target.titleKey}`,
      videoPaths: target.videoPaths,
      profileId: profile.id,
      outputDirectory: target.outputDirectory,
      scopeLabel: target.scopeLabel
    });
    navigate("media");
  }

  if (!settings) {
    return (
      <main className="app app-loading">
        <Loader2 className="spin" size={24} />
      </main>
    );
  }

  return (
    <main className={`app app-page-${activePage} theme-${theme}`}>
      <AppSidebar
        activePage={activePage}
        uiLanguage={uiLanguage}
        theme={theme}
        logoUrl={appLogoUrl}
        onNavigate={navigate}
        onToggleLanguage={toggleLanguage}
        onToggleTheme={toggleTheme}
      />

      <div className="app-shell">
        {activePage !== "media" && <div className="app-view" key={activePage}>
          {activePage === "stats" && <Suspense fallback={null}><StatsPage /></Suspense>}
          {activePage === "discover" && <DiscoverPage uiLanguage={uiLanguage} />}
          {activePage === "downloaded" && (
            <Suspense fallback={null}>
              <DownloadedPage workflowProfiles={workflowProfiles} onPrepareWorkflow={prepareDownloadedWorkflow} />
            </Suspense>
          )}
          {activePage === "translate" && (
            <TranslatePage
              uiLanguage={uiLanguage}
              settings={settings}
              keys={keys}
              workspace={workspace}
              onSettingsChange={appData.setSettings}
              onSaveSettings={appData.saveSettings}
            />
          )}
        </div>}
        {mediaPageMounted && (
          <div className="app-view app-page-mount" hidden={activePage !== "media"}>
            <Suspense fallback={null}>
              <MediaToolsPage
                onSaveWorkflowProfile={appData.saveWorkflowProfile}
                onDeleteWorkflowProfile={appData.deleteWorkflowProfile}
                settings={settings}
                workflowProfiles={workflowProfiles}
                hasGeminiKey={keys.hasGeminiKey}
                hasVercelKey={keys.hasVercelKey}
                videoPath={workspace.videoPath}
                probe={workspace.probe}
                selectedTrack={workspace.selectedTrack}
                latestTranslatedSubtitlePath={workspace.result?.outputPath}
                onVideoLoaded={workspace.acceptProbedVideo}
                onSubtitleTrackSelected={workspace.setSelectedTrack}
                libraryLaunch={mediaLibraryLaunch}
              />
            </Suspense>
          </div>
        )}
      </div>
      {downloads.progress && (
        <DownloadProgressMonitor
          collapsed={downloads.collapsed}
          progress={downloads.progress}
          onCollapse={downloads.collapse}
          onDismiss={downloads.dismiss}
          onExpand={downloads.expand}
          onCancel={downloads.cancel}
          onReveal={(path) => window.subtitleTranslator.showItemInFolder(path)}
        />
      )}
    </main>
  );
}
