# SubsTranslate 1.0

A Windows desktop application for extracting subtitle tracks from video, translating them into Bulgarian, and producing timing-preserving SRT files or remuxed media files. Version 1.0 supports text subtitles, fully local OCR for image-based PGS subtitles, managed downloads, media preparation, and torrent discovery in one desktop interface.

> The source is public to read, but no license is granted: it may not be copied, modified or redistributed without the owner's permission. Download the Windows installer to use the app.

## Install

To use the app without any development tools, run `SubsTranslate-Setup-<version>.exe`. It installs for the current user without an administrator prompt, then adds **SubsTranslate** to the Start Menu, Windows Search and the desktop. Node.js, FFmpeg and the OCR models are all included.

- The installer is not code-signed, so Windows SmartScreen may say it "protected your PC". Choose **More info → Run anyway**.
- To translate, open **Settings** and enter your own Gemini or Vercel AI Gateway key.
- **Torrent in app** additionally needs [Python 3.12](https://www.python.org/downloads/) with **Add python.exe to PATH** ticked. Everything else works without Python.
- Settings, API keys and history are kept in `%APPDATA%ulgarian-subtitle-translator` and survive uninstalling or updating.

To build the installer yourself, follow **Getting started** below, then run `npm run dist:win`. It writes `release/SubsTranslate-Setup-<version>.exe`. Run `npm run setup:torrent` first if the installer should include the torrent engine.

## Version 1.0

This release brings the complete local workflow together:

- Translation uses one fixed **Balanced** profile; the ineffective quality slider has been removed.
- The Media workflow extracts text subtitles while audio is being translated or remuxed, avoiding a second full read of the source file.
- Media progress is phase-weighted and advances continuously during long-running work instead of jumping only when a whole stage completes.
- The Media page now presents saved workflows as selectable cards, applies them immediately, and keeps creation and editing in the same page. A selected workflow shows only the inputs needed for that run and uses one Run workflow action.
- Progress uses completed subtitle cues and FFmpeg output time, keeps 100% for successful completion, and shows only the latest update in a compact fixed-height card.
- Discover shelves replace title-count badges with Show more / Show less controls that expand each shelf into a responsive grid.
- The refreshed interface defaults to a charcoal and midnight-blue dark theme with quieter page chrome and fewer redundant labels.
- Audio selectors show language, codec, channel count, a readable channel layout, and bitrate. Matroska metadata and stream-size fallbacks recover bitrate when FFprobe omits its standard field.
- Discover source cards show the source audio language. Multi-language releases prioritize the English badge to keep the card compact.
- The existing Episode menu supports selecting any combination of episodes. Selected entries keep a simple checkmark and subtle blue tint, and the same selection works with torrent clients and debrid downloads.
- The Discover title-details header stays fixed while the drawer content scrolls, without adding a focus border around the drawer.
- Downloaded files can be opened in the computer's default media player or deleted through a confirmation flow; library files are sent to the Recycle Bin when the platform supports it.
- Real-Debrid downloads have responsive progress details, recover cleanly from stale provider-cache claims, and allow completed, failed, or cancelled notifications to be dismissed permanently.
- Custom season, episode, media-track, and downloaded-title menus avoid the Electron native-dropdown freeze seen when switching between Media and Downloaded.
- The compact layout keeps all five navigation destinations usable, and the interface can be switched between English and Bulgarian.

## Interface redesign

The current interface is built on a shared design system:

- Light and dark themes come from one set of design tokens (colour, spacing, radius, type, shadow and motion) in `src/renderer/styles/tokens.css`, split into focused stylesheets per area instead of one large stylesheet.
- The sidebar collapses to an icon rail in narrow windows. Pages enter with short, staggered motion that respects the system's reduced-motion setting.
- **Translate** has single-video and folder-batch modes, one run card with progress, estimate and cancel, and a single save-to row.
- **Media** shows a run card with progress and cancel, opens workflows for editing from their tile, and explains what is missing before a run can start.
- **Discover** puts search, filters and settings in one header row. Poster shelves fill the full window width and fit a whole number of posters per row, so cards grow and shrink with the window instead of leaving a cut-off poster at the edge.
- **Title details** turn the backdrop into a play button when a trailer is available. Clicking it plays the YouTube trailer inside the drawer, with **Full screen**, **YouTube** (open in the browser) and close controls. Escape stops the trailer before it closes the drawer.
- **Downloaded** uses a poster grid with a sticky detail panel; **Statistics** has summary tiles, clickable history rows and a request inspector.
- Discover requests its catalog as soon as the page opens. Account checks such as the Real-Debrid status run in the background, so a slow provider no longer delays the posters.

Trailers are embedded from `youtube-nocookie.com`. The packaged app loads its pages from local files, which send no `Referer` header, so the main process adds one to trailer embed requests; YouTube otherwise refuses to play the embed (player error 153).

## Highlights

- Detects embedded subtitle and audio tracks with bundled FFprobe.
- Extracts SRT, ASS/SSA, WebVTT, MOV text, and PGS subtitle tracks.
- Decodes and OCRs PGS subtitles locally without uploading subtitle images.
- Uses a CUDA-accelerated PP-OCRv6 recognizer with guarded Tesseract CPU fallback for English PGS subtitles.
- Batches GPU work while validating every cue's confidence and visible-line count before accepting it.
- Translates with Google Gemini or Vercel AI Gateway; a mock provider is available for development.
- Preserves cue timings and validates generated SRT output.
- Splits subtitles into scene-aware chunks with configurable context and a fixed balanced quality profile.
- Extracts text subtitle tracks during the Media workflow's audio/remux pass so Translate + Build reads the original video only once.
- Handles provider rate limits, retries, cancellation, resumable sessions, and translation caching.
- Supports single-file, folder-batch, and selected-media-batch workflows with per-file progress.
- Checkpoints media batches and resumes interrupted work without repeating completed files or cached translation chunks.
- Exports subtitle tracks independently or adds Bulgarian subtitles to MKV, MP4, or MOV output.
- Reads external subtitle files as ANSI/Windows-1251, UTF-16 LE/BE, UTF-8, or UTF-8 with BOM.
- Can copy the original audio or convert it to AC-3 5.1, E-AC-3 5.1, or AAC stereo.
- Adjusts transcoded audio from -6 dB to +6 dB across every channel, with clipping protection for positive gain.
- Saves unified workflow profiles with independently enabled Translation, Audio, Subtitles, and Media output parts.
- Uses a streamlined Stremio-inspired interface with Discover, Downloaded, Translate, Media, and Statistics in one persistent sidebar.
- Includes light and dark themes built from shared design tokens; the choice persists between launches.
- Plays title trailers inside the app, inline in the Discover details drawer, with full-screen playback.
- Includes persistent English and Bulgarian interface modes.
- Recommends movies and TV shows from local likes, favourites, completed or partial watch history, dislikes, hidden titles, and built-in tokenless metadata.
- Filters Discover titles by media type, rating, genre, and location-dependent streaming-service availability.
- Optionally enriches Discover cards and title details with Rotten Tomatoes critic/audience scores, Metacritic, Letterboxd, Trakt, TMDB, and other ratings through MDBList.
- Finds torrent options through a selectable community scraper (Torrentio, Comet, or MediaFusion), safely opens magnets, and supports managed downloads through Real-Debrid, AllDebrid, Premiumize, TorBox, or Debrid-Link.
- Organizes completed downloads into a recoverable local movie/TV library and prepares saved profiles for a movie, episode, or whole season.
- Remembers the five most recent successful Discover searches locally for quick reuse.
- Supports hold-and-drag horizontal scrolling across Discover title shelves without opening the dragged title.
- Uses bundled FFmpeg and FFprobe binaries, so users do not need a system FFmpeg installation.
- Provides a fast Windows Start Menu launcher that rebuilds only when source files have changed.
- Records token usage, estimated cost, run history, and model exchanges in local application data.

## Technology

- Electron 43
- React 18
- TypeScript
- Vite 8
- Vitest
- FFmpeg and FFprobe static binaries
- Tesseract.js and PP-OCRv6 through ONNX Runtime
- PaddleOCR 3.7 and PaddlePaddle CUDA 12.6 for accelerated PGS recognition
- Google Gen AI SDK and the Vercel AI Gateway API

## Requirements

- Windows 10 or newer
- Node.js `20.19+` or `22.12+`
- npm
- A Gemini API key or Vercel AI Gateway key for real translations
- Optional API key for each debrid service you use; Real-Debrid, AllDebrid, Premiumize, TorBox, and Debrid-Link keys are stored separately with OS encryption
- Optional MDBList API key for multi-source movie and TV ratings
- Optional Python 3.12 for **Torrent in app** downloads
- Sufficient free disk space for dependencies, OCR models, extracted subtitle images, and media output

FFmpeg, FFprobe, the English Tesseract language data, and the PP-OCRv6 model files are included through dependencies or repository assets; no system FFmpeg installation is required.

## Getting started

Clone the repository and install the locked Node dependencies:

```powershell
git clone https://github.com/warbladebg/SubsTranslate-Windows.git
cd SubsTranslate-Windows
npm ci
```

### Enable NVIDIA GPU OCR

The application works without this step by using the bundled CPU OCR paths. For accelerated PGS export, install the local CUDA sidecar after cloning.

GPU prerequisites:

- NVIDIA GPU with CUDA compute capability 7.5 or newer
- A current NVIDIA driver compatible with CUDA 12.6
- Python 3.12 available through the Windows `py` launcher
- Approximately 5 GB of free disk space under the repository directory

Run the pinned installer from the repository root:

```powershell
powershell -ExecutionPolicy Bypass -File .\sidecars\paddle-gpu\install.ps1
```

The installer creates `sidecars/paddle-gpu/.venv`, installs PaddlePaddle GPU and cuDNN, downloads `PP-OCRv6_medium_rec` into `sidecars/paddle-gpu/models`, and verifies that Paddle can select `gpu:0`. Those generated directories are intentionally ignored by Git. Re-running the installer is safe and refreshes the pinned dependencies without moving the assets off the repository drive.

Start the Vite development server and Electron application:

```powershell
npm run dev
```

For a production-style local build and launch:

```powershell
npm start
```

On Windows, install a Start Menu shortcut once with:

```powershell
npm run install-windows
```

You can then open **SubsTranslate** from Windows Search without a terminal window. The shortcut installer also sets up the torrent engine when Python 3.12 is available; without it, it prints a warning and everything else still works. The launcher starts the current build immediately and recompiles only when an input source, asset, dependency manifest, or build configuration is newer than the generated application. Pass `-ForceBuild` directly to `scripts/launch-windows-shortcut.ps1` when a clean rebuild is required.

## Initial configuration

Open **Settings** in the app and choose a provider:

1. **Mock** — exercises the workflow without making a paid API request.
2. **Gemini** — enter a Google Gemini API key and select a Gemini model.
3. **Vercel** — enter a Vercel AI Gateway key and select a gateway model.

API keys are encrypted with Electron `safeStorage` and written to the operating system's application-data directory. They are not stored in this repository or in environment files.

The default output-conflict policy creates versioned files instead of overwriting existing output. Provider rate limits default to a conservative automatic mode and can be configured manually in Settings.

## Interface and appearance

The application uses a persistent left sidebar with **Discover** at the top, followed by **Downloaded**, **Translate**, **Media**, and **Statistics**. Each workflow keeps its existing functionality while sharing the same navigation, page header, panels, controls, and status language.

Use the **Dark theme** switch at the bottom of the sidebar to change the appearance of the entire application. Dark mode is the default for a fresh installation, and the choice is stored locally for later launches. Both themes are defined by the same design tokens, so forms, tables, dialogs, title cards, source results, notices, and the Discover details drawer switch together.

Use the language control to switch the application chrome between English and Bulgarian. The preference is stored locally. In narrow windows the sidebar collapses to an icon rail so no destination is clipped. Frequently used season, episode, media-track, and downloaded-title selectors use in-app menus instead of native Electron popup menus, keeping the rest of the interface interactive while a menu is open or after changing pages.

Discover shelves span the full window width and show a whole number of posters, from five at the default window size up to twelve on very wide screens. They can be browsed with the scrollbar, mouse wheel where supported, touch gestures, or by holding the primary mouse button on a poster and dragging left or right. A short movement threshold separates dragging from clicking, so a normal click still opens title details and dragging does not trigger an accidental selection.

## Main workflows

### Translate an embedded subtitle track

1. Choose a video.
2. Select a supported embedded subtitle track.
3. Choose the translation context settings.
4. Select an output directory.
5. Run the translation.

The application extracts the selected track, performs local OCR when the source is PGS, translates scene-aware chunks, validates the reconstructed subtitles, and writes a Bulgarian `.srt` file while preserving timings.

### Translate a folder batch

The **Batch** panel sits directly below the Translation controls. Choose a folder and start the batch to detect its video files, select a compatible subtitle track from each file, and translate them sequentially with the current Translation settings. If an API quota, credit, billing, or safety limit pauses the run, **Continue Batch** retries the interrupted file and skips files already marked complete. Successful chunks inside the interrupted file are restored from the translation cache.

### Export subtitle tracks

Choose an individual supported track or export every supported subtitle track. Text tracks are extracted directly; PGS tracks are converted to SRT through local OCR.

### Build media

The media tools can:

- add an existing Bulgarian subtitle file;
- translate a selected track before remuxing;
- extract a selected text subtitle during the audio/remux pass when translation is enabled, avoiding a second read of the original file;
- omit subtitles and only transform audio;
- process a selected batch of videos sequentially with the same audio, subtitle, container, output, and replacement settings;
- checkpoint media batches after every file stage, pause on API quota or credit errors, and continue after an app restart without rebuilding completed files or retranslating cached chunks;
- copy the original audio or encode AC-3 5.1, E-AC-3 5.1, or AAC stereo;
- attenuate or boost the selected transcoded audio track from -6 dB to +6 dB without changing its channel layout;
- write MKV, MP4, or MOV output;
- replace an existing MKV when explicitly selected.

Video is stream-copied during the remux workflow. Positive audio gain uses a latency-compensated multichannel limiter to prevent hard clipping. MKV is recommended because it preserves the broadest range of source streams. MP4 and MOV convert text subtitles to native `mov_text` and are rejected before writing when a video, audio, image-subtitle, data, or attachment stream cannot be preserved safely.

Audio-track choices include the detected language, codec, channel count, a readable channel layout such as **5.1 side surrounds**, and bitrate. When Matroska does not expose the normal FFprobe bitrate field, SubsTranslate also checks container tags and derives a bitrate from stream bytes and duration when the metadata is sufficient. Media progress advances from measured work: FFmpeg output time during media processing and completed subtitle cues during translation. The compact progress card keeps a fixed height, displays only the latest development, and reserves 100% for successful completion.

Switch the Media page from **Single file** to **Batch files** to select individual videos rather than an entire folder. One selected video acts as the reference for audio-track position and embedded subtitle choice; equivalent tracks are matched in the remaining files. The chosen audio profile, gain, subtitle action, encoding, container, conflict policy, output directory, and replacement mode are then applied to every file. Existing external subtitles are matched to videos by filename, with an optional `.bg`, `.bul`, `.bulgarian`, or `.translated` suffix.

External subtitle decoding can be selected explicitly as **ANSI** (Windows-1251), **UTF-16 LE**, **UTF-16 BE**, **UTF-8**, or **UTF-8 with BOM**. New translations are written as UTF-8.

Media batch state is saved after probing, translation, subtitle creation, media building, and completion. HTTP 402/429, exhausted quota, insufficient credits, billing limits, and the app safety cap pause the queue and expose **Continue batch**. The saved file list, reference tracks, settings, intermediate translated subtitle, output directory, and per-file status are restored after restarting the app.

### Workflow profiles

Create reusable **Workflow profiles** directly in Media and enable only the parts that should run:

- **Translation** stores the provider, model, rate limits, context, preferred subtitle language, sample mode, and subtitle-file collision policy. Translation quality is fixed to Balanced.
- **Media output** controls whether a processed video is created.
- **Process audio** can be disabled to copy the original audio unchanged, or enabled to store the audio format and gain.
- **Include subtitles** can be disabled, can embed the profile's new Bulgarian translation, or can use an existing subtitle selected on the Media page when Translation is disabled.

Collision controls are shown only when they can affect the result. Translation-only profiles choose what happens when the generated subtitle file already exists. Media profiles show the output-file collision policy only while creating a new file; replacing the original MKV does not expose an irrelevant filename policy.

The Translate page lists profiles with Translation enabled. **Apply profile** loads that profile's Translation settings and preferred track into the visible controls; the page keeps one **Translate** action instead of a second overlapping run button. The Media page presents media-enabled profiles as cards. Selecting a card applies it immediately, hides configuration controls already defined by the profile, and leaves only relevant file or track inputs plus one **Run workflow** button. **New workflow** and **Edit workflow** open the profile editor in Media. **Custom setup** exposes all controls for a one-off run. Existing two-type profile stores are migrated automatically: legacy Translation profiles become translation-only workflows, while legacy Media profiles retain their media behavior and absorb the settings from any linked Translation profile.

Profiles store behavior, not secrets or content: API keys, source paths, subtitle paths, and output directories are never written into a profile. This keeps profiles portable between jobs while credentials remain protected by the operating system.

### Manage downloaded movies and TV shows

Add one or more folders under **Discovery settings → Download libraries**. A location can be on an internal disk,
another local drive, or an external hard drive. Choose a default for new downloads, then use the **Save this download
to** selector in a title's debrid source panel to override it for that download. SubsTranslate creates and
maintains this structure in every location:

```text
<chosen folder>/
  Movies/
    Title (Year) [IMDb ID]/
      release.mkv
      Processed/
  TV Shows/
    Title (Year) [IMDb ID]/
      Season 01/
        release.S01E01.mkv
      Processed/
        Season 01/
  .substranslate/
    library.json
    location.json       # present when the location is marked external
```

Mark a removable location as **External / removable drive** while it is connected. SubsTranslate writes a random
identity marker inside that library—not at the root of the drive—and remembers the library's path relative to the
volume. On startup and when **Find external drives** is pressed in Settings or Downloaded, the app checks connected
Windows drive letters for that exact marker. It can therefore recover the location after Windows assigns the drive a
different letter, without recursively searching the drive or mistaking another disk for it. Missing libraries remain
configured but cannot be selected until they are found. Removing a location from Settings never deletes its files,
and the final configured location cannot be removed.

In-app torrent and debrid downloads go directly to the selected managed folder. An existing filename is versioned instead of overwritten. The hidden local index retains poster and title metadata. To import files downloaded outside the app, place each movie in its own folder under `Movies` and each show in its own folder under `TV Shows`, then select **Downloaded → Rescan**. The scan includes videos directly in those folders and in nested release or season folders across every connected location. It reads show and episode numbers from common folder and filename patterns; files without a season appear under **Unsorted**. Files beneath `Processed` are excluded from source indexing.

The selected file can be opened with **Play**, which delegates to the default media player configured in Windows. **Delete** asks for confirmation and removes the library item without leaving a stale catalogue entry; on supported systems the media file is moved to the Recycle Bin rather than being permanently erased.

Open **Downloaded**, select a movie or TV show, then choose one episode or an entire season and select one Workflow profile. The page shows whether Translation, Audio, and Media output are enabled. A media-enabled profile prepares the scope in Media and runs all enabled parts; a translation-only profile prepares it in Translate. There is no second overlapping profile selector. Multi-file season runs use the existing resumable batch workflows. New-file profile output is routed into the title's `Processed` folder. Profiles explicitly configured to replace originals still work, but the Downloaded page asks for confirmation first.

### Discover movies and TV shows

Open **Discover**, the first item in the application sidebar and the default launch page, and start browsing immediately. Movie and TV metadata loads from Cinemeta's unauthenticated catalog endpoints; there is no metadata account, API key, or token to configure. The app loads popular movie and TV candidates, then re-ranks them locally using weighted likes, favourites, completed watches, partial TV progress, dislikes, hidden titles, interaction recency, genre similarity, media type, original language, ratings, freshness, popularity, and diversity. Strong positive interactions also seed related Cinemeta catalog requests, while already watched or otherwise saved titles are lowered so the row prioritizes new discoveries. TV details let you mark the currently selected episode watched or unwatched; the show is considered fully watched only after every known regular episode is complete, unless the whole show is marked watched manually. Horizontal title shelves support hold-and-drag browsing. Each shelf has **Show more** in place of a title-count badge; it expands the shelf into a responsive grid and changes to **Show less**. Search results and title details are fetched only when needed and cached in memory. The five most recent successful searches are stored locally on the device, appear when the search field is focused, support Arrow Up/Arrow Down and Enter keyboard selection, and can be cleared from the history menu.

When a TV show is opened, its drawer resumes at the episode immediately after the latest episode recorded from a completed in-app download. The selection advances across season boundaries, ignores specials, and is also used by the automatic source search. New shows begin at the first regular episode; fully watched shows remain on their final episode. The Episode menu is generated from the selected season's known episode count and includes **Entire season**. Click additional episodes in the same menu to build a multi-episode selection; selected entries show a checkmark and a subtle blue tint while the menu stays open. Clicking the only selected episode again clears the selection and disables source search until another episode or **Entire season** is chosen. The title-details toolbar remains fixed at the top while the rest of the drawer scrolls.

Cinemeta is Stremio's official metadata addon but is an external service with no app-owned availability guarantee. Obtain the provider's permission and review its current terms before redistributing an integration that depends on its catalog.

The **Filters** button beneath the Discover heading narrows the currently loaded catalog by movie/TV type, minimum rating, any of the selected genres, and any of the selected streaming services. Genre, type, and rating filters are applied locally. Streaming availability is queried only after at least one service is selected, is cached for six hours, and can vary by network location. Availability checks use Stremio's external WatchHub service; review its current terms and obtain any required permission before redistributing this integration.

When one or more streaming services are selected, Discover keeps the recommended movie and TV shelves first and places a service-catalogue preview directly after them. The preview's **Show more** action opens a dedicated browser with its own title search, media-type, genre, rating, and service filters plus paginated loading. WatchHub does not publish a standalone provider catalogue, so this view pages through Cinemeta's catalogue and verifies each batch against WatchHub before showing it.

IMDb scores continue to work without configuration. To add Rotten Tomatoes critic and audience scores plus other rating sources, open **Discovery settings → Ratings & metadata**, create an MDBList API key, paste it, and save. The key is validated with MDBList, encrypted through the operating system, and never sent to the renderer. Multi-source ratings are cached in memory for 24 hours. Only text score labels are shown; no third-party score logos are bundled. MDBList and the underlying rating sources are external services with their own availability, attribution, and licensing requirements.

The tokenless catalog uses IMDb IDs instead of the numeric TMDB IDs used by the earlier experimental build. Existing Discover preferences are retained during upgrade, but old TMDB-based likes and watch-history entries cannot be converted reliably without another metadata credential and are ignored.

Torrent sources are queried after selecting a title. Pressing **Find sources** refreshes the results. Discovery settings select one of the fixed built-in scraper endpoints: Torrentio, Comet, or MediaFusion's documented Midnight community instance. The renderer and saved preferences can select only those known endpoints. Responses are bounded, normalized, filtered to the requested title, TV episode, or full-season pack, deduplicated by info hash and file index, then ordered by highest resolution and largest file size. Sources without a known resolution or size appear after comparable sources with known values. The maximum-size and minimum-seeder settings still filter results before sorting; maximum size defaults to 0 (unlimited), and existing saved limits remain in effect. Release and provider metadata can advertise subtitles and audio languages; these are labels, not verified media tracks.

These scrapers are independent third-party services with no app-owned availability guarantee. A source search discloses the requested IMDb identifier and your network address to the selected scraper. When Real-Debrid is selected, its token is sent to Torrentio or Comet in their server-side configuration path to obtain cached results; Comet requests torrent results as well, so uncached releases remain visible. MediaFusion searches use its public torrent stream endpoint and the Real-Debrid account is checked separately. Tokens and scraper playback URLs never cross into the renderer or application logs. Each other debrid service needs its own API key; a Real-Debrid token cannot authenticate to them.

**Torrent in app** reconstructs a sanitized magnet from the normalized info hash and optional safe trackers, downloads with libtorrent-rasterbar (the engine used by qBittorrent) in a hidden Python worker, and saves the selected video files to the chosen managed library. No debrid account or separate torrent client window is required. Run `npm run setup:torrent` once to install the pinned Windows libtorrent binding; `npm run install-windows` also does this when needed. Python 3.12 must be available on `PATH`, or its executable set in `SUBSTRANSLATE_PYTHON`. For a multi-episode selection, SubsTranslate checks the torrent's actual file list before selecting only those episodes. The download monitor shows progress, speed, peers, and cancellation. The worker closes when the selected files finish, so completed downloads do not continue seeding. In **Downloaded**, select a file and press **Seed torrent** to verify and share its original torrent; **Stop seeding** closes that worker. The original torrent files remain as hard links in the hidden `.substranslate/torrent-staging` folder so seeding does not require a second full copy. Deleting a managed file removes its hidden link. An interrupted download does not resume after restarting the app. Peers may receive pieces while a download is still in progress; the Seed button controls sharing after completion. If a system torrent handler is installed, **Open in external client** remains available.

**Debrid downloads** use the selected debrid account and save only video files from the matching torrent into the managed library:

- An exact info hash already listed with `status: downloaded` in the connected Real-Debrid account is labeled **Account cached**.
- The app queries Torrentio with its standard `realdebrid=` configuration, extracts the normalized info hash and file index from each returned playback route, discards the credential-bearing route, and shows `[RD+]`/`⚡` results as **Provider cached**.
- On download, a provider-cached source is added with a sanitized magnet. A single selection chooses only the matched media file; a multi-episode selection chooses only the checked episodes from a season pack; and an entire-season selection chooses every regular episode from the requested season. Samples, extras, trailers, other seasons, and unselected episodes are excluded. The app then waits briefly for Real-Debrid to report `status: downloaded`.
- A stale provider claim or unverified torrent fails without downloading the file and triggers best-effort removal of the newly created Real-Debrid torrent entry.
- The torrent status, hash, selected file, and link are revalidated immediately before `/unrestrict/link` is called.
- Downloads stream to a temporary `.part` file, validate the HTTP content length when supplied, and are atomically moved into the managed Movies or TV Shows library only after completion. The responsive progress monitor's **More information** control shows live speed, elapsed time, estimated time remaining, and transferred size without covering the surrounding controls. Cancelling waits for the partial file to be deleted before the cancellation completes. Completed, failed, and cancelled messages all have a close button that permanently dismisses the terminal notification.

Real-Debrid removed its global instant-availability endpoint. Provider-cached labels therefore remain claims until download time; stale claims can fail even though they appeared in the cached list.

Premiumize and TorBox cache results are checked through their own APIs before they appear in debrid mode, then checked again before download. AllDebrid and Debrid-Link do not expose a non-mutating global hash check: candidates are marked unverified during search, and the selected hash is checked for an immediately ready file when download starts. This may add the selected hash to the debrid account. The app does not wait for an uncached torrent to download. A community scraper cannot guarantee that a torrent is safe or licensed; verify the release before opening it in a torrent client.

Use torrent search and downloads only for media you are legally entitled to access, such as public-domain works, openly licensed releases, or your own distributed material.

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Run Vite and Electron in development mode. |
| `npx vite --host 127.0.0.1` | Preview the renderer alone in a browser; file pickers, probes, the library, profiles, and statistics are filled with demo data. |
| `npm run lint` | Run ESLint across the project. |
| `npm start` | Build the project and launch Electron. |
| `npm run install-windows` | Install the terminal-free SubsTranslate Start Menu shortcut. The launcher reuses a current build and only recompiles after source or build-config changes. |
| `npm run build` | Compile Electron code and build the renderer. |
| `npm run dist:win` | Build and package the Windows installer into `release/`. |
| `npm run build:electron` | Compile the Electron main/preload/core TypeScript. |
| `npm run typecheck` | Type-check renderer, core, tests, main, and preload code. |
| `npm test` | Run the offline Vitest suite. |
| `npm run test:gemini` | Enable the opt-in real Gemini test path. |
| `npm run benchmark:pgs -- <track.sup> <reference.srt> <output.srt>` | Run the local PGS OCR accuracy benchmark. |

Normal tests do not call Gemini. Treat `npm run test:gemini` as an opt-in integration test that may consume API quota when a real test is configured.

The offline media suite includes signal-level checks for AC-3, E-AC-3, AAC, DTS and TrueHD input, 5.1/7.1 channel routing, downmixing, gain accuracy, clipping, dropouts, duration, and effective A/V synchronization.

## PGS OCR benchmark

Build the Electron code and compare an OCR result with a reference SRT:

```powershell
npm run benchmark:pgs -- D:\path\track.sup D:\path\reference.srt D:\path\ocr-output.srt
```

The benchmark reports cue recall, exact-cue rate, character accuracy, and word accuracy. Set `PGS_BENCHMARK_REUSE=1` to reuse an existing OCR output instead of running OCR again.

### Local GPU OCR

When `sidecars/paddle-gpu` is installed, English PGS extraction uses the local CUDA PP-OCRv6 recognizer by default. The model stays resident in GPU memory for the export, groups 32 cues per transport batch, and accepts a GPU result only when its confidence, text plausibility, and visible-line count pass validation. An uncertain result or runtime error is retried with the bundled CPU Tesseract engine so acceleration does not silently omit a line or cue.

The GPU sidecar and models remain under this repository's directory. It does not call a hosted OCR or vision API. On an 869-cue evaluation track, the batched RTX 3080 path took 29.2 seconds versus 340 seconds on CPU (11.6x faster), retained all reference cues, and measured 99.851% case-insensitive character accuracy and 99.590% word accuracy. Very short tracks show a smaller gain because CUDA/model startup takes about four seconds.

## Optional environment variables

| Variable | Effect |
| --- | --- |
| `SUBS_TRANSLATE_WORK_DIR` | Overrides the extraction scratch directory (default: `work/extracted`). |
| `SUBS_TRANSLATE_OCR_MODEL_DIR` | Overrides the PP-OCRv6 model directory. |
| `SUBS_TRANSLATE_OCR_ENGINE` | Selects `gpu`, `tesseract`, or `paddle`; defaults to `gpu` when its local sidecar is installed. |
| `SUBS_TRANSLATE_GPU_OCR_DIR` | Overrides the local Paddle CUDA sidecar directory. |
| `SUBS_TRANSLATE_GPU_MIN_CONFIDENCE` | Sets the GPU acceptance threshold from 0-100 (default: `96`); lower-confidence cues use CPU fallback. |
| `SUBS_TRANSLATE_GPU_BATCH_SIZE` | Sets the number of subtitle cues submitted per CUDA batch (default: `32`, maximum: `128`). |
| `SUBS_TRANSLATE_GPU_INFERENCE_BATCH_SIZE` | Controls PP-OCRv6's internal image batch (default: `1`); larger values can be faster but caused measurable mixed-width accuracy drift in evaluation. |
| `SUBS_TRANSLATE_OCR_DEBUG=1` | Enables OCR debug output. |
| `SUBS_TRANSLATE_OCR_EXHAUSTIVE=1` | Enables more exhaustive OCR preprocessing. |
| `PGS_BENCHMARK_REUSE=1` | Reuses benchmark OCR output. |
| `RUN_REAL_GEMINI_TESTS=true` | Enables the opt-in real-provider Gemini test path. |

Do not commit environment files, API keys, user-data exports, model-exchange logs, source media, translated subtitle work products, or local investigation notes. The repository `.gitignore` excludes these by default. API keys and tokens are only ever entered in the app, where they are encrypted with the operating system; none are read from the repository.

## Project structure

```text
src/
  core/       Subtitle parsing, chunking, translation providers, validation, and usage accounting
  main/       Electron services for media probing, extraction, OCR, translation, persistence, and remuxing
  preload/    Restricted renderer-to-main IPC bridge
  renderer/   React desktop interface
scripts/      Windows launch/install helpers, PGS benchmarking, and local evaluation utilities
sidecars/     Bundled PP-OCRv6 model assets
.github/      Continuous integration workflow
tests/        Unit and workflow tests
```

Generated builds live in `dist/` and `dist-electron/`. Dependencies, builds, scratch extraction data, local evaluation artifacts, application history, credentials, media, and subtitle work files are intentionally excluded from Git.

## Data and security notes

- API keys are encrypted at rest with the operating system-backed Electron `safeStorage` API.
- PGS decoding and OCR run locally.
- Text sent to Gemini or Vercel leaves the machine and is governed by the selected provider's policies.
- Local translation history may contain source and translated dialogue; keep the application-data directory private.
- Source videos and generated subtitles can contain copyrighted or sensitive material and should not be committed.
- The Electron renderer uses a preload bridge rather than direct Node.js access.

## Verification before committing

Run the standard local checks:

```powershell
npm run typecheck
npm run lint
npm test
npm run build
```

Before pushing, also inspect ignored and staged files:

```powershell
git status --short --ignored
git diff --cached --stat
```

## Repository status

This repository is maintained by its owner. It does not accept outside contributions, and its source and bundled assets may not be redistributed without the owner's explicit approval.
