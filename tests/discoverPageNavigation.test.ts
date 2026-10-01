// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createElement, StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RECENT_DISCOVERY_SEARCHES_STORAGE_KEY } from "../src/core/discovery/RecentSearches";
import { discoveryGenreId } from "../src/core/discovery/DiscoveryFilters";
import type {
  CatalogDetails,
  CatalogItem,
  DiscoveryAction,
  DiscoveryInteraction,
  DiscoveryPreferences,
  SourceSearchResult,
  StreamingCatalogueRequest,
  TorrentSource
} from "../src/core/discovery/DiscoveryTypes";
import type { SubtitleTranslatorApi } from "../src/preload";
import { DiscoverPage } from "../src/renderer/components/DiscoverPage";

const preferences: DiscoveryPreferences = {
  language: "en-US",
  region: "BG",
  preferredMediaType: "all",
  preferredQuality: "1080p",
  maxSizeGb: 30,
  minSeeders: 0,
  defaultDownloadDirectory: "D:\\Downloads"
};

const sintel: CatalogItem = {
  id: "tt1727587",
  mediaType: "movie",
  title: "Sintel",
  overview: "An open movie.",
  releaseDate: "2010-09-27",
  genreIds: [discoveryGenreId("Animation")],
  voteAverage: 7.4,
  voteCount: 2_000,
  popularity: 80,
  runtimeMinutes: 15
};

const sintelDetails: CatalogDetails = {
  ...sintel,
  imdbId: sintel.id,
  runtimeMinutes: 15,
  genres: [{ id: 16, name: "Animation" }],
  cast: [],
  crew: [],
  videos: [],
  seasons: [],
  recommendations: []
};

const bigBuckBunny: CatalogItem = {
  ...sintel,
  id: "tt1254207",
  title: "Big Buck Bunny",
  releaseDate: "2008-04-10",
  voteAverage: 7.1
};

const bigBuckBunnyDetails: CatalogDetails = {
  ...sintelDetails,
  ...bigBuckBunny,
  imdbId: bigBuckBunny.id
};

const resumeSeries: CatalogItem = {
  ...sintel,
  id: "tt0000100",
  mediaType: "series",
  title: "Resume Test Series"
};

const resumeSeriesDetails: CatalogDetails = {
  ...sintelDetails,
  ...resumeSeries,
  imdbId: resumeSeries.id,
  seasons: [
    { seasonNumber: 0, name: "Specials", episodeCount: 2 },
    { seasonNumber: 1, name: "Season 1", episodeCount: 2 },
    { seasonNumber: 2, name: "Season 2", episodeCount: 3 }
  ]
};

const sourceSearchResult: SourceSearchResult = {
  searchedAt: "2026-07-17T00:00:00.000Z",
  providerErrors: [],
  sources: [{
    id: "sintel-1080p",
    provider: "Torrentio",
    infoHash: "0123456789abcdef0123456789abcdef01234567",
    name: "Sintel.2010.1080p",
    quality: "1080p",
    seeders: 12,
    trackers: ["udp://tracker.example:80"],
    observedAt: "2026-07-17T00:00:00.000Z",
    providerClaimedCached: false,
    cacheStatus: "unknown"
  }]
};

let simulatedScrollY = 0;
let frameId = 0;

beforeEach(() => {
  window.localStorage.clear();
  simulatedScrollY = 0;
  frameId = 0;
  Object.defineProperty(window, "scrollY", {
    configurable: true,
    get: () => simulatedScrollY
  });
  Object.defineProperty(window, "scrollTo", {
    configurable: true,
    value: vi.fn((options: ScrollToOptions) => {
      simulatedScrollY = options.top ?? simulatedScrollY;
    })
  });
  Object.defineProperty(window, "requestAnimationFrame", {
    configurable: true,
    value: vi.fn((callback: FrameRequestCallback) => {
      const id = ++frameId;
      window.setTimeout(() => callback(performance.now()), 0);
      return id;
    })
  });
  Object.defineProperty(window, "cancelAnimationFrame", {
    configurable: true,
    value: vi.fn()
  });
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn()
    }))
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("Discover settings navigation", () => {
  it("shows Rotten Tomatoes and other source ratings with year and runtime metadata", async () => {
    const api = createDiscoveryApi(false);
    api.getDiscoveryCredentialStatus = vi.fn().mockResolvedValue({
      hasRealDebridToken: false,
      hasMdblistApiKey: true
    });
    api.getDiscoveryRatings = vi.fn().mockResolvedValue({
      entries: [{
        key: `movie:${sintel.id}`,
        ratings: [
          { source: "imdb", value: 7.6, votes: 2_000 },
          { source: "tomatoes", value: 91, votes: 146 },
          { source: "popcorn", value: 86, votes: 2_430 },
          { source: "metacritic", value: 78, votes: 38 },
          { source: "letterboxd", value: 3.8, votes: 18_200 }
        ]
      }],
      checkedItems: 1,
      failedItems: 0
    });
    window.subtitleTranslator = api;
    const user = userEvent.setup();

    renderPage();

    await waitFor(() => expect(api.getDiscoveryRatings).toHaveBeenCalledWith([
      { id: sintel.id, mediaType: "movie" }
    ]));
    expect(await screen.findByTitle("Rotten Tomatoes critics: 91% · 146 ratings")).toBeTruthy();
    expect(screen.getByText("15 min")).toBeTruthy();

    await user.click((await screen.findAllByRole("button", { name: /Sintel/ }))[0]);
    const detailsDialog = await screen.findByRole("dialog", { name: "Title details" });
    expect(within(detailsDialog).getByTitle("Rotten Tomatoes critics: 91% · 146 ratings")).toBeTruthy();
    expect(within(detailsDialog).getByTitle("Letterboxd: 3.8/5 · 18,200 ratings")).toBeTruthy();
  });

  it("opens filters under Discover and applies genre and streaming-service selections", async () => {
    const api = createDiscoveryApi(false);
    api.getDiscoveryHome = vi.fn().mockResolvedValue({
      generatedAt: "2026-07-17T00:00:00.000Z",
      sections: [{ id: "open-films", title: "Open films", items: [sintel, bigBuckBunny] }]
    });
    api.getDiscoveryStreamingAvailability = vi.fn().mockResolvedValue({
      entries: [
        { key: `movie:${sintel.id}`, services: ["netflix"] },
        { key: `movie:${bigBuckBunny.id}`, services: ["prime-video"] }
      ],
      checkedItems: 2,
      failedItems: 0
    });
    window.subtitleTranslator = api;
    const user = userEvent.setup();

    renderPage();

    await user.click(await screen.findByRole("button", { name: "Filters" }));
    const filters = screen.getByRole("region", { name: "Filters" });
    await user.click(within(filters).getByRole("checkbox", { name: "Animation" }));
    await user.click(within(filters).getByRole("checkbox", { name: "Netflix" }));
    await user.click(within(filters).getByRole("button", { name: "Apply filters" }));

    await waitFor(() => {
      expect(api.getDiscoveryStreamingAvailability).toHaveBeenCalledWith([
        { id: sintel.id, mediaType: "movie" },
        { id: bigBuckBunny.id, mediaType: "movie" }
      ]);
    });
    expect(screen.getByText("Sintel")).toBeTruthy();
    expect(screen.queryByText("Big Buck Bunny")).toBeNull();
    expect(screen.getByText(/2 filters active/)).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(await screen.findByText("Big Buck Bunny")).toBeTruthy();
  });

  it("keeps recommendations first and opens a separately filtered streaming catalogue", async () => {
    const api = createDiscoveryApi(false);
    api.getDiscoveryHome = vi.fn().mockResolvedValue({
      generatedAt: "2026-07-17T00:00:00.000Z",
      sections: [
        { id: "recommended-movies", title: "Recommended movies", items: [sintel] },
        { id: "recommended-series", title: "Recommended TV shows", items: [resumeSeries] },
        { id: "popular-movies", title: "Popular movies", items: [bigBuckBunny] }
      ]
    });
    api.getDiscoveryStreamingAvailability = vi.fn().mockResolvedValue({
      entries: [
        { key: `movie:${sintel.id}`, services: ["netflix"] },
        { key: `series:${resumeSeries.id}`, services: ["netflix"] },
        { key: `movie:${bigBuckBunny.id}`, services: ["netflix"] }
      ],
      checkedItems: 3,
      failedItems: 0
    });
    api.getDiscoveryStreamingCatalogue = vi.fn(async (request: StreamingCatalogueRequest) => ({
      items: request.showAll ? [resumeSeries] : [sintel, bigBuckBunny],
      nextSkip: request.showAll ? 150 : 100,
      hasMore: !request.showAll,
      scannedItems: request.showAll ? 50 : 100,
      failedItems: 0
    }));
    window.subtitleTranslator = api;
    const user = userEvent.setup();

    renderPage();

    await user.click(await screen.findByRole("button", { name: "Filters" }));
    const filters = screen.getByRole("region", { name: "Filters" });
    await user.click(within(filters).getByRole("checkbox", { name: "Netflix" }));
    await user.click(within(filters).getByRole("button", { name: "Apply filters" }));

    const rowHeadings = await screen.findAllByRole("heading", { level: 3 });
    expect(rowHeadings.slice(0, 3).map((heading) => heading.textContent)).toEqual([
      "Recommended movies",
      "Recommended TV shows",
      "Netflix catalogue"
    ]);

    await user.click(within(screen.getByRole("region", { name: "Netflix catalogue" })).getByRole("button", { name: "Show more" }));
    await waitFor(() => expect(api.getDiscoveryStreamingCatalogue).toHaveBeenCalledWith({
      streamingServices: ["netflix"],
      mediaType: "all",
      genreIds: [],
      minimumRating: 0,
      query: "",
      skip: 0,
      showAll: false
    }));
    expect(await screen.findByRole("heading", { name: "Netflix catalogue", level: 2 })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Catalogue filters" })).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Show all" }));
    await waitFor(() => expect(api.getDiscoveryStreamingCatalogue).toHaveBeenLastCalledWith({
      streamingServices: ["netflix"],
      mediaType: "all",
      genreIds: [],
      minimumRating: 0,
      query: "",
      skip: 100,
      showAll: true
    }));
    expect(await screen.findByText("Resume Test Series")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Show all" })).toBeNull();

    await user.type(screen.getByRole("searchbox", { name: "Search this streaming catalogue" }), "Sintel");
    await user.click(screen.getByRole("button", { name: "Search catalogue" }));
    await waitFor(() => expect(api.getDiscoveryStreamingCatalogue).toHaveBeenLastCalledWith({
      streamingServices: ["netflix"],
      mediaType: "all",
      genreIds: [],
      minimumRating: 0,
      query: "Sintel",
      skip: 0,
      showAll: false
    }));
  });

  it("saves likes, favourites, and watched titles in their collections", async () => {
    const api = createDiscoveryApi(false);
    window.subtitleTranslator = api;
    const user = userEvent.setup();

    renderPage();

    const homeRow = await screen.findByLabelText("Open films titles");
    const likeButton = within(homeRow).getByRole("button", { name: "Like" });
    await user.click(likeButton);

    await waitFor(() => {
      expect(api.setDiscoveryInteraction).toHaveBeenCalledWith(sintel, "liked", true);
      expect(likeButton.getAttribute("aria-pressed")).toBe("true");
    });

    await user.click(screen.getByRole("button", { name: "Likes (1)" }));
    expect(screen.getByRole("heading", { name: "Liked titles" })).toBeTruthy();
    const likedRow = screen.getByLabelText("Liked titles titles");
    expect(within(likedRow).getByRole("button", { name: /Sintel/ })).toBeTruthy();

    await user.click(within(likedRow).getByRole("button", { name: "Favourite" }));
    await waitFor(() => {
      expect(api.setDiscoveryInteraction).toHaveBeenCalledWith(sintel, "watchlisted", true);
    });

    await user.click(screen.getByRole("button", { name: "Favourites (1)" }));
    expect(screen.getByRole("heading", { name: "Favourite titles" })).toBeTruthy();
    const favouriteRow = screen.getByLabelText("Favourite titles titles");
    const favouriteTitle = within(favouriteRow).getByRole("button", { name: /Sintel/ });
    expect(favouriteTitle).toBeTruthy();

    await user.click(favouriteTitle);
    await screen.findByRole("dialog", { name: "Title details" });
    await user.click(screen.getByRole("button", { name: "Watched" }));
    await waitFor(() => {
      expect(api.setDiscoveryInteraction).toHaveBeenCalledWith(sintelDetails, "watched", true);
    });
    await user.click(screen.getByRole("button", { name: "Close details" }));

    const watchedFavouriteCard = within(favouriteRow).getByRole("button", { name: /Sintel/ }).closest("article");
    expect(watchedFavouriteCard).toBeTruthy();
    expect(within(watchedFavouriteCard!).getByRole("img", { name: "Watched" })).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Watched (1)" }));
    expect(screen.getByRole("heading", { name: "Watched titles" })).toBeTruthy();
    expect(within(screen.getByLabelText("Watched titles titles"))
      .getByRole("button", { name: /Sintel/ })).toBeTruthy();
  });

  it("drag-scrolls a catalog row without opening the dragged title", async () => {
    window.subtitleTranslator = createDiscoveryApi(false);
    const user = userEvent.setup();

    renderPage();

    const catalogRow = await screen.findByLabelText("Open films titles");
    const titleButton = within(catalogRow).getByRole("button", { name: /Sintel/ });
    catalogRow.scrollLeft = 20;

    fireEvent.pointerDown(titleButton, {
      button: 0,
      clientX: 300,
      pointerId: 1,
      pointerType: "mouse"
    });
    fireEvent.pointerMove(catalogRow, {
      clientX: 150,
      pointerId: 1,
      pointerType: "mouse"
    });
    fireEvent.pointerUp(catalogRow, {
      clientX: 150,
      pointerId: 1,
      pointerType: "mouse"
    });
    fireEvent.click(titleButton);

    expect(catalogRow.scrollLeft).toBe(170);
    expect(screen.queryByRole("dialog", { name: "Title details" })).toBeNull();

    await user.click(titleButton);
    expect(await screen.findByRole("dialog", { name: "Title details" })).toBeTruthy();
  });

  it("remembers successful searches and reruns them from the focused search field", async () => {
    const api = createDiscoveryApi(false);
    window.subtitleTranslator = api;
    const user = userEvent.setup();

    renderPage();

    const searchInput = await screen.findByRole("textbox", { name: "Search movies and TV shows" });
    await user.type(searchInput, "Big Buck Bunny");
    await user.click(screen.getByRole("button", { name: "Search" }));
    await waitFor(() => {
      expect(api.searchDiscoveryCatalog).toHaveBeenCalledWith("Big Buck Bunny");
    });
    expect(JSON.parse(window.localStorage.getItem(RECENT_DISCOVERY_SEARCHES_STORAGE_KEY) ?? "[]"))
      .toEqual(["Big Buck Bunny"]);

    cleanup();
    renderPage();

    const restoredInput = await screen.findByRole<HTMLInputElement>(
      "textbox",
      { name: "Search movies and TV shows" }
    );
    await user.click(restoredInput);
    const recentSearches = screen.getByRole("region", { name: "Recent searches" });
    await user.click(within(recentSearches).getByRole("button", { name: "Big Buck Bunny" }));

    await waitFor(() => {
      expect(api.searchDiscoveryCatalog).toHaveBeenCalledTimes(2);
    });
    expect(restoredInput.value).toBe("Big Buck Bunny");
    expect(screen.queryByRole("region", { name: "Recent searches" })).toBeNull();

    await user.click(restoredInput);
    await user.click(
      within(screen.getByRole("region", { name: "Recent searches" }))
        .getByRole("button", { name: "Clear" })
    );
    expect(window.localStorage.getItem(RECENT_DISCOVERY_SEARCHES_STORAGE_KEY)).toBeNull();
    expect(screen.queryByRole("region", { name: "Recent searches" })).toBeNull();
  });

  it("selects recent searches with the arrow keys and runs one with Enter", async () => {
    window.localStorage.setItem(
      RECENT_DISCOVERY_SEARCHES_STORAGE_KEY,
      JSON.stringify(["Sintel", "Big Buck Bunny"])
    );
    const api = createDiscoveryApi(false);
    window.subtitleTranslator = api;
    const user = userEvent.setup();

    renderPage();

    const searchInput = await screen.findByRole("textbox", { name: "Search movies and TV shows" });
    await user.click(searchInput);
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("region", { name: "Recent searches" })).toBeNull();

    await user.keyboard("{ArrowDown}");
    const recentSearches = screen.getByRole("region", { name: "Recent searches" });
    const sintelSearch = within(recentSearches).getByRole("button", { name: "Sintel" });
    const bunnySearch = within(recentSearches).getByRole("button", { name: "Big Buck Bunny" });
    expect(document.activeElement).toBe(sintelSearch);

    await user.keyboard("{ArrowDown}");
    expect(document.activeElement).toBe(bunnySearch);
    await user.keyboard("{Escape}");
    expect(document.activeElement).toBe(searchInput);
    expect(screen.queryByRole("region", { name: "Recent searches" })).toBeNull();

    await user.keyboard("{ArrowDown}{ArrowDown}{Enter}");

    await waitFor(() => expect(api.searchDiscoveryCatalog).toHaveBeenCalledWith("Big Buck Bunny"));
    expect((searchInput as HTMLInputElement).value).toBe("Big Buck Bunny");
    expect(screen.queryByRole("region", { name: "Recent searches" })).toBeNull();
  });

  it("opens title details as a modal drawer and restores focus on Escape", async () => {
    window.subtitleTranslator = createDiscoveryApi(false);
    const user = userEvent.setup();

    renderPage();

    const titleTrigger = (await screen.findAllByRole("button", { name: /Sintel/ }))[0];
    await user.click(titleTrigger);
    const detailsPanel = await screen.findByRole("dialog", { name: "Title details" });

    await waitFor(() => expect(document.activeElement).toBe(detailsPanel));
    expect(detailsPanel.getAttribute("aria-modal")).toBe("true");
    expect(document.querySelector(".discover-details-backdrop")).not.toBeNull();
    expect(document.body.style.overflow).toBe("hidden");

    await user.keyboard("{Escape}");
    await waitFor(() => expect(document.activeElement).toBe(titleTrigger));
    expect(screen.queryByRole("dialog", { name: "Title details" })).toBeNull();
    expect(document.body.style.overflow).toBe("");
  });

  it("automatically finds normal torrent sources when a title is opened", async () => {
    const api = createDiscoveryApi(false);
    window.subtitleTranslator = api;
    const user = userEvent.setup();

    renderPage();

    await user.click((await screen.findAllByRole("button", { name: /Sintel/ }))[0]);
    await screen.findByRole("dialog", { name: "Title details" });
    await screen.findByRole("button", { name: "Download" });

    expect(screen.getByRole("button", { name: "Torrent in app" }).getAttribute("aria-pressed")).toBe("true");
    expect(api.searchTorrentSources).toHaveBeenCalledTimes(1);
    expect(api.searchTorrentSources).toHaveBeenCalledWith({
      media: sintelDetails,
      season: undefined,
      episode: undefined
    });
    await user.click(screen.getByRole("button", { name: "Open in external client" }));
    expect(api.openTorrentSource).toHaveBeenCalledWith(sourceSearchResult.sources[0]);
  });

  it("builds the episode dropdown from the season count and searches only season packs", async () => {
    const seriesDetails: CatalogDetails = {
      ...sintelDetails,
      mediaType: "series",
      title: "Open Show",
      seasons: [{ seasonNumber: 2, name: "Season 2", episodeCount: 3 }]
    };
    const seasonPack: TorrentSource = {
      ...sourceSearchResult.sources[0],
      name: "Open.Show.S02.Complete.1080p",
      isSeasonPack: true
    };
    const api = createDiscoveryApi(false);
    api.getDiscoveryDetails = vi.fn().mockResolvedValue(seriesDetails);
    api.searchTorrentSources = vi.fn().mockResolvedValue({ ...sourceSearchResult, sources: [seasonPack] });
    window.subtitleTranslator = api;
    const user = userEvent.setup();

    renderPage();
    await user.click((await screen.findAllByRole("button", { name: /Sintel/ }))[0]);
    await screen.findByRole("dialog", { name: "Title details" });
    const episodeSelect = screen.getByRole("combobox", { name: "Episode" });
    await user.click(episodeSelect);
    const episodeOptions = screen.getByRole("listbox", { name: "Episode options" });

    expect(within(episodeOptions).getAllByRole("option").map((option) => option.textContent)).toEqual([
      "Entire season",
      "Episode 1",
      "Episode 2",
      "Episode 3"
    ]);

    await user.click(within(episodeOptions).getByRole("option", { name: "Entire season" }));
    await user.click(screen.getByRole("button", { name: "Find sources" }));

    expect(api.searchTorrentSources).toHaveBeenLastCalledWith({
      media: seriesDetails,
      season: 2,
      episode: undefined
    });
    expect(await screen.findByRole("button", { name: "Download season" })).toBeTruthy();
    expect(screen.getByText("Season pack")).toBeTruthy();
  });

  it("opens a TV show at the episode after the latest downloaded episode", async () => {
    const api = createDiscoveryApi(false);
    api.getDiscoveryState = vi.fn().mockResolvedValue({
      preferences,
      interactions: [{
        key: "series:tt0000100",
        item: resumeSeries,
        liked: false,
        disliked: false,
        watched: false,
        watchedEpisodes: ["s1e1", "s1e2"],
        knownEpisodeCount: 5,
        watchedManually: false,
        watchlisted: false,
        hidden: false,
        updatedAt: "2026-07-17T00:00:00.000Z"
      }]
    });
    api.getDiscoveryHome = vi.fn().mockResolvedValue({
      generatedAt: "2026-07-17T00:00:00.000Z",
      sections: [{ id: "series", title: "TV", items: [resumeSeries] }]
    });
    api.getDiscoveryDetails = vi.fn().mockResolvedValue(resumeSeriesDetails);
    window.subtitleTranslator = api;
    const user = userEvent.setup();

    renderPage();

    await user.click((await screen.findAllByRole("button", { name: /Resume Test Series/ }))[0]);
    const seasonSelect = await screen.findByRole("combobox", { name: "Season" });
    const episodeInput = screen.getByRole("combobox", { name: "Episode" });

    expect(seasonSelect.textContent).toContain("Season 2");
    expect(episodeInput.textContent).toContain("Episode 1");
    await waitFor(() => expect(api.searchTorrentSources).toHaveBeenCalledWith({
      media: resumeSeriesDetails,
      season: 2,
      episode: 1
    }));
  });

  it("marks the selected TV episode watched and lets it be marked unwatched again", async () => {
    const api = createDiscoveryApi(false);
    api.getDiscoveryHome = vi.fn().mockResolvedValue({
      generatedAt: "2026-07-17T00:00:00.000Z",
      sections: [{ id: "series", title: "TV", items: [resumeSeries] }]
    });
    api.getDiscoveryDetails = vi.fn().mockResolvedValue(resumeSeriesDetails);
    api.setDiscoveryEpisodeWatched = vi.fn(async (
      media: CatalogDetails,
      season: number,
      episode: number,
      active: boolean
    ): Promise<DiscoveryInteraction> => ({
      key: `series:${media.id}`,
      item: media,
      liked: false,
      disliked: false,
      watched: false,
      watchedEpisodes: active ? [`s${season}e${episode}`] : [],
      knownEpisodeCount: 5,
      watchedManually: false,
      watchlisted: false,
      hidden: false,
      updatedAt: "2026-07-17T00:00:00.000Z"
    }));
    window.subtitleTranslator = api;
    const user = userEvent.setup();

    renderPage();

    await user.click((await screen.findAllByRole("button", { name: /Resume Test Series/ }))[0]);
    expect(await screen.findByText("0 of 5 regular episodes watched")).toBeTruthy();

    const watchedButton = screen.getByRole("button", {
      name: "Mark season 1 episode 1 as watched"
    });
    await user.click(watchedButton);

    await waitFor(() => expect(api.setDiscoveryEpisodeWatched).toHaveBeenCalledWith(
      resumeSeriesDetails,
      1,
      1,
      true
    ));
    expect(await screen.findByText("1 of 5 regular episodes watched")).toBeTruthy();
    const episodeSelect = screen.getByRole("combobox", { name: "Episode" });
    await user.click(episodeSelect);
    let episodeOptions = screen.getByRole("listbox", { name: "Episode options" });
    expect(within(episodeOptions).getByRole("option", { name: "Episode 1 ✓" })).toBeTruthy();
    expect(within(episodeOptions).getByRole("option", { name: "Episode 2" })).toBeTruthy();

    await user.click(screen.getByRole("button", {
      name: "Mark season 1 episode 1 as unwatched"
    }));
    await waitFor(() => expect(api.setDiscoveryEpisodeWatched).toHaveBeenLastCalledWith(
      resumeSeriesDetails,
      1,
      1,
      false
    ));
    await user.click(episodeSelect);
    episodeOptions = screen.getByRole("listbox", { name: "Episode options" });
    expect(within(episodeOptions).getByRole("option", { name: "Episode 1" })).toBeTruthy();
    expect(within(episodeOptions).queryByRole("option", { name: "Episode 1 ✓" })).toBeNull();
  });

  it("keeps keyboard focus in the drawer and closes from the blurred backdrop", async () => {
    window.subtitleTranslator = createDiscoveryApi(false);
    const user = userEvent.setup();

    renderPage();

    const titleTrigger = (await screen.findAllByRole("button", { name: /Sintel/ }))[0];
    await user.click(titleTrigger);
    const detailsPanel = await screen.findByRole("dialog", { name: "Title details" });
    await screen.findByRole("heading", { name: "Sintel" });
    await waitFor(() => expect(document.activeElement).toBe(detailsPanel));

    const focusable = Array.from(detailsPanel.querySelectorAll<HTMLButtonElement>("button:not([disabled])"));
    await user.tab({ shift: true });
    expect(document.activeElement).toBe(focusable.at(-1));

    const backdrop = document.querySelector<HTMLElement>(".discover-details-backdrop");
    expect(backdrop).not.toBeNull();
    await user.click(backdrop!);

    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Title details" })).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(titleTrigger));
  });

  it("returns focus to Discovery settings when the title opener is no longer mounted", async () => {
    window.subtitleTranslator = createDiscoveryApi(false);
    const user = userEvent.setup();

    renderPage();

    const titleTrigger = (await screen.findAllByRole("button", { name: /Sintel/ }))[0];
    await user.click(titleTrigger);
    await screen.findByRole("dialog", { name: "Title details" });

    const searchInput = screen.getByRole("textbox", { name: "Search movies and TV shows" });
    await user.type(searchInput, "Sintel");
    await user.click(screen.getByRole("button", { name: "Search" }));
    await waitFor(() => expect(titleTrigger.isConnected).toBe(false));
    expect(screen.getByRole("heading", { name: "Search results for “Sintel”" })).toBeTruthy();

    await user.type(searchInput, " draft");
    expect(screen.getByRole("heading", { name: "Search results for “Sintel”" })).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Close details" }));
    const settingsTrigger = screen.getByRole("button", { name: "Discovery settings" });
    await waitFor(() => expect(document.activeElement).toBe(settingsTrigger));
  });

  it("restores focus after hiding a title removes its catalog card", async () => {
    let titleHidden = false;
    const api = createDiscoveryApi(false);
    api.getDiscoveryHome = vi.fn(async () => ({
      generatedAt: "2026-07-17T00:00:00.000Z",
      sections: [{ id: "open-films", title: "Open films", items: titleHidden ? [] : [sintel] }]
    }));
    api.setDiscoveryInteraction = vi.fn(async () => {
      titleHidden = true;
      return {
        key: "movie:tt1727587",
        item: sintel,
        liked: false,
        disliked: false,
        watched: false,
        watchlisted: false,
        hidden: true,
        updatedAt: "2026-07-17T00:00:00.000Z"
      };
    });
    window.subtitleTranslator = api;
    const user = userEvent.setup();

    renderPage();

    await user.click((await screen.findAllByRole("button", { name: /Sintel/ }))[0]);
    await screen.findByRole("dialog", { name: "Title details" });
    await user.click(screen.getByRole("button", { name: "Hide" }));

    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Title details" })).toBeNull());
    const settingsTrigger = screen.getByRole("button", { name: "Discovery settings" });
    await waitFor(() => expect(document.activeElement).toBe(settingsTrigger));
  });

  it("falls back to the standard details header when backdrop artwork fails", async () => {
    const api = createDiscoveryApi(false);
    api.getDiscoveryDetails = vi.fn().mockResolvedValue({
      ...sintelDetails,
      backdropPath: "https://example.invalid/missing-backdrop.jpg"
    });
    window.subtitleTranslator = api;
    const user = userEvent.setup();

    renderPage();

    await user.click((await screen.findAllByRole("button", { name: /Sintel/ }))[0]);
    await screen.findByRole("dialog", { name: "Title details" });
    const backdrop = document.querySelector<HTMLImageElement>(".details-backdrop");
    expect(backdrop).not.toBeNull();

    fireEvent.error(backdrop!);

    await waitFor(() => expect(document.querySelector(".details-backdrop")).toBeNull());
    expect(document.querySelector(".details-title-row")?.classList.contains("no-backdrop")).toBe(true);
    expect(screen.getByRole("heading", { name: "Sintel" })).toBeTruthy();
  });

  it("ignores stale details when a newer title resolves first", async () => {
    const sintelRequest = createDeferred<CatalogDetails>();
    const bunnyRequest = createDeferred<CatalogDetails>();
    const api = createDiscoveryApi(false);
    api.getDiscoveryHome = vi.fn().mockResolvedValue({
      generatedAt: "2026-07-17T00:00:00.000Z",
      sections: [{ id: "open-films", title: "Open films", items: [sintel, bigBuckBunny] }]
    });
    api.getDiscoveryDetails = vi.fn((_, id) => (
      id === sintel.id ? sintelRequest.promise : bunnyRequest.promise
    ));
    window.subtitleTranslator = api;
    const user = userEvent.setup();

    renderPage();

    await user.click((await screen.findAllByRole("button", { name: /Sintel/ }))[0]);
    await screen.findByRole("dialog", { name: "Title details" });
    await user.click((await screen.findAllByRole("button", { name: /Big Buck Bunny/ }))[0]);
    await waitFor(() => expect(api.getDiscoveryDetails).toHaveBeenCalledTimes(2));

    await act(async () => {
      bunnyRequest.resolve(bigBuckBunnyDetails);
      await bunnyRequest.promise;
    });
    await screen.findByRole("heading", { name: "Big Buck Bunny" });

    await act(async () => {
      sintelRequest.resolve(sintelDetails);
      await sintelRequest.promise;
    });
    expect(screen.getByRole("heading", { name: "Big Buck Bunny" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Sintel" })).toBeNull();
  });

  it("ignores a manual source search after switching to another title", async () => {
    const staleSources = createDeferred<SourceSearchResult>();
    const api = createDiscoveryApi(false);
    api.getDiscoveryHome = vi.fn().mockResolvedValue({
      generatedAt: "2026-07-17T00:00:00.000Z",
      sections: [{ id: "open-films", title: "Open films", items: [sintel, bigBuckBunny] }]
    });
    api.getDiscoveryDetails = vi.fn(async (_, id) => id === sintel.id ? sintelDetails : bigBuckBunnyDetails);
    api.searchTorrentSources = vi.fn()
      .mockResolvedValueOnce(sourceSearchResult)
      .mockImplementationOnce(() => staleSources.promise)
      .mockResolvedValue({ ...sourceSearchResult, sources: [] });
    window.subtitleTranslator = api;
    const user = userEvent.setup();
    renderPage();
    await user.click((await screen.findAllByRole("button", { name: /Sintel/ }))[0]);
    await screen.findByRole("button", { name: "Download" });
    await user.click(screen.getByRole("button", { name: "Find sources" }));
    await user.click(screen.getByRole("button", { name: "Close details" }));
    await user.click((await screen.findAllByRole("button", { name: /Big Buck Bunny/ }))[0]);
    await screen.findByRole("heading", { name: "Big Buck Bunny" });
    await act(async () => {
      staleSources.resolve(sourceSearchResult);
      await staleSources.promise;
    });
    expect(screen.queryByRole("button", { name: "Download" })).toBeNull();
    expect(screen.queryByText(sourceSearchResult.sources[0].name)).toBeNull();
  });

  it("ignores an initial source response after the selected season changes", async () => {
    const staleSources = createDeferred<SourceSearchResult>();
    const api = createDiscoveryApi(false);
    api.getDiscoveryDetails = vi.fn().mockResolvedValue(resumeSeriesDetails);
    api.searchTorrentSources = vi.fn(() => staleSources.promise);
    window.subtitleTranslator = api;
    const user = userEvent.setup();
    renderPage();
    await user.click((await screen.findAllByRole("button", { name: /Sintel/ }))[0]);
    await user.click(await screen.findByRole("combobox", { name: "Season" }));
    await user.click(screen.getByRole("option", { name: "Season 2 (3)" }));
    await act(async () => {
      staleSources.resolve(sourceSearchResult);
      await staleSources.promise;
    });
    expect(screen.queryByRole("button", { name: "Download" })).toBeNull();
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Find sources" }).disabled).toBe(false);
  });

  it("does not reopen details after an in-flight request is closed", async () => {
    const detailsRequest = createDeferred<CatalogDetails>();
    const api = createDiscoveryApi(false);
    api.getDiscoveryDetails = vi.fn(() => detailsRequest.promise);
    window.subtitleTranslator = api;
    const user = userEvent.setup();

    renderPage();

    await user.click((await screen.findAllByRole("button", { name: /Sintel/ }))[0]);
    await screen.findByRole("dialog", { name: "Title details" });
    await user.click(screen.getByRole("button", { name: "Close details" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Title details" })).toBeNull());

    await act(async () => {
      detailsRequest.resolve(sintelDetails);
      await detailsRequest.promise;
    });
    expect(screen.queryByRole("dialog", { name: "Title details" })).toBeNull();
  });

  it("uses a dedicated view and preserves catalog state, unsaved settings, focus, and scroll", async () => {
    window.subtitleTranslator = createDiscoveryApi(false);
    const focusSpy = vi.spyOn(HTMLElement.prototype, "focus");
    const user = userEvent.setup();

    renderPage();

    const settingsTrigger = await screen.findByRole("button", { name: "Discovery settings" });
    const searchInput = screen.getByRole("textbox", { name: "Search movies and TV shows" });
    expect(window.scrollTo).not.toHaveBeenCalled();
    expect(document.activeElement).not.toBe(settingsTrigger);

    await user.type(searchInput, "Sintel draft");
    await user.click((await screen.findAllByRole("button", { name: /Sintel/ }))[0]);
    await screen.findByRole("dialog", { name: "Title details" });

    simulatedScrollY = 640;
    await user.click(settingsTrigger);

    const backButton = await screen.findByRole("button", { name: "Back to Discover" });
    await waitFor(() => expect(document.activeElement).toBe(backButton));
    expect(screen.getByRole("heading", { name: "Discovery & downloads" })).toBeTruthy();
    expect(screen.queryByRole("textbox", { name: "Search movies and TV shows" })).toBeNull();
    expect(screen.queryByRole("dialog", { name: "Title details" })).toBeNull();

    await user.clear(screen.getByLabelText("Minimum seeders"));
    await user.type(screen.getByLabelText("Minimum seeders"), "12");
    await user.click(backButton);

    const restoredTrigger = await screen.findByRole("button", { name: "Discovery settings" });
    await waitFor(() => expect(document.activeElement).toBe(restoredTrigger));
    expect(screen.getByRole<HTMLInputElement>("textbox", { name: "Search movies and TV shows" }).value)
      .toBe("Sintel draft");
    expect(screen.getByRole("dialog", { name: "Title details" })).toBeTruthy();
    expect(simulatedScrollY).toBe(640);
    expect(focusSpy).toHaveBeenLastCalledWith({ preventScroll: true });

    await user.click(restoredTrigger);
    expect((await screen.findByLabelText<HTMLInputElement>("Minimum seeders")).value).toBe("12");
  });

  it("manages download libraries and can search for external drives from settings", async () => {
    const api = createDiscoveryApi(false);
    window.subtitleTranslator = api;
    const user = userEvent.setup();

    renderPage();

    await user.click(await screen.findByRole("button", { name: "Discovery settings" }));
    expect(await screen.findByRole("heading", { name: "Download libraries" })).toBeTruthy();
    expect(screen.getByText("D:\\Downloads")).toBeTruthy();

    await user.click(screen.getByLabelText("External / removable drive"));
    await waitFor(() => expect(api.setDownloadLocationExternal).toHaveBeenCalledWith("downloads", true));

    await user.click(screen.getByRole("button", { name: "Find external drives" }));
    await waitFor(() => expect(api.scanExternalDownloadLocations).toHaveBeenCalled());
  });

  it("saves a selected scraper and a separate debrid API key", async () => {
    const api = createDiscoveryApi(false);
    api.setOtherDebridApiToken = vi.fn().mockResolvedValue({ connected: true });
    api.clearOtherDebridApiToken = vi.fn().mockResolvedValue(undefined);
    api.getDiscoveryCredentialStatus = vi.fn().mockResolvedValue({
      hasRealDebridToken: false, hasMdblistApiKey: false, hasDebridTokens: { torbox: true }
    });
    window.subtitleTranslator = api;
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole("button", { name: "Discovery settings" }));
    await user.selectOptions(screen.getByLabelText("Torrent scraper"), "comet");
    await user.selectOptions(screen.getByLabelText("Download provider"), "torbox");
    await user.type(screen.getByLabelText("TorBox API key"), "torbox-secret");
    await user.click(screen.getByRole("button", { name: "Save settings" }));

    await waitFor(() => expect(api.setOtherDebridApiToken).toHaveBeenCalledWith("torbox", "torbox-secret"));
    expect(api.saveDiscoveryPreferences).toHaveBeenCalledWith(expect.objectContaining({
      sourceProvider: "comet", debridProvider: "torbox"
    }));
  });

  it("returns an automatic Real-Debrid redirect to the control that opened settings", async () => {
    const api = createDiscoveryApi(false);
    window.subtitleTranslator = api;
    const focusSpy = vi.spyOn(HTMLElement.prototype, "focus");
    const user = userEvent.setup();

    renderPage();

    await user.click((await screen.findAllByRole("button", { name: /Sintel/ }))[0]);
    await screen.findByRole("dialog", { name: "Title details" });
    await user.click(screen.getByRole("button", { name: "Find sources" }));
    await screen.findByRole("button", { name: "Download" });

    simulatedScrollY = 900;
    await user.click(screen.getByRole("button", { name: "Real-Debrid cached" }));

    const backButton = await screen.findByRole("button", { name: "Back to Discover" });
    await waitFor(() => expect(document.activeElement).toBe(backButton));
    expect(screen.getByRole("alert").textContent).toContain(
      "Connect Real-Debrid in Discovery settings first."
    );
    expect(screen.queryByRole("dialog", { name: "Title details" })).toBeNull();

    await user.click(backButton);

    const restoredMethod = await screen.findByRole("button", { name: "Real-Debrid cached" });
    await waitFor(() => expect(document.activeElement).toBe(restoredMethod));
    expect(screen.getByRole("dialog", { name: "Title details" })).toBeTruthy();
    expect(screen.getByText("No cached sources found.")).toBeTruthy();
    expect(simulatedScrollY).toBe(900);
    expect(focusSpy).toHaveBeenLastCalledWith({ preventScroll: true });
    expect(api.getVerifiedRealDebridSources).not.toHaveBeenCalled();
  });

  it("shows provider-labeled cached sources in Real-Debrid mode", async () => {
    const providerSource: TorrentSource = {
      ...sourceSearchResult.sources[0],
      providerClaimedCached: true,
      cacheStatus: "provider-claimed-cached"
    };
    const api = createDiscoveryApi(true);
    vi.mocked(api.searchTorrentSources).mockResolvedValue({
      ...sourceSearchResult,
      sources: [providerSource]
    });
    vi.mocked(api.getVerifiedRealDebridSources).mockResolvedValue([providerSource]);
    window.subtitleTranslator = api;
    const user = userEvent.setup();

    renderPage();

    await user.click((await screen.findAllByRole("button", { name: /Sintel/ }))[0]);
    await screen.findByRole("dialog", { name: "Title details" });
    await user.click(screen.getByRole("button", { name: "Find sources" }));
    await screen.findByRole("button", { name: "Download" });
    await user.click(screen.getByRole("button", { name: "Real-Debrid cached" }));

    expect(await screen.findByText("Provider cached")).toBeTruthy();
    expect(screen.getByText("Availability is confirmed with Real-Debrid when the download starts.")).toBeTruthy();
    expect(api.getVerifiedRealDebridSources).toHaveBeenCalled();
  });

  it("automatically searches the selected episode when Real-Debrid mode is chosen", async () => {
    const seriesDetails: CatalogDetails = {
      ...sintelDetails,
      mediaType: "series",
      title: "Open Show",
      seasons: [{ seasonNumber: 1, name: "Season 1", episodeCount: 2 }]
    };
    const providerSource: TorrentSource = {
      ...sourceSearchResult.sources[0],
      name: "Open.Show.S01E02.1080p",
      providerClaimedCached: true,
      cacheStatus: "provider-claimed-cached"
    };
    const api = createDiscoveryApi(true);
    api.getDiscoveryDetails = vi.fn().mockResolvedValue(seriesDetails);
    api.searchTorrentSources = vi.fn().mockResolvedValue({ ...sourceSearchResult, sources: [providerSource] });
    api.getVerifiedRealDebridSources = vi.fn().mockResolvedValue([providerSource]);
    window.subtitleTranslator = api;
    const user = userEvent.setup();

    renderPage();
    await user.click((await screen.findAllByRole("button", { name: /Sintel/ }))[0]);
    await screen.findByRole("dialog", { name: "Title details" });
    await user.click(screen.getByRole("combobox", { name: "Episode" }));
    await user.click(screen.getByRole("option", { name: "Episode 1" }));
    await user.click(screen.getByRole("option", { name: "Episode 2" }));
    await user.keyboard("{Escape}");
    vi.mocked(api.searchTorrentSources).mockClear();

    await user.click(screen.getByRole("button", { name: "Real-Debrid cached" }));

    await waitFor(() => expect(api.searchTorrentSources).toHaveBeenCalledWith({
      media: seriesDetails,
      season: 1,
      episode: 2
    }));
    expect(api.getVerifiedRealDebridSources).toHaveBeenCalledWith({
      sources: [providerSource],
      media: seriesDetails,
      season: 1,
      episode: 2
    });
    expect(await screen.findByText("Provider cached")).toBeTruthy();
  });

  it.each(["torrent", "real-debrid"])("selects episodes in the existing dropdown for %s", async (method) => {
    const api = createDiscoveryApi(true);
    const series = { ...resumeSeriesDetails, seasons: [{ seasonNumber: 1, name: "Season 1", episodeCount: 3 }] };
    const pack: TorrentSource = { ...sourceSearchResult.sources[0], isSeasonPack: true, selectedFileIndices: [0, 4], providerClaimedCached: true, cacheStatus: "provider-claimed-cached" };
    api.getDiscoveryDetails = vi.fn().mockResolvedValue(series);
    api.searchTorrentSources = vi.fn().mockResolvedValue({ ...sourceSearchResult, sources: [pack] });
    api.getVerifiedRealDebridSources = vi.fn().mockResolvedValue([pack]);
    api.startRealDebridDownload = vi.fn().mockResolvedValue(undefined);
    window.subtitleTranslator = api;
    const user = userEvent.setup();
    renderPage();
    await user.click((await screen.findAllByRole("button", { name: /Sintel/ }))[0]);
    if (method === "real-debrid") {
      await user.click(await screen.findByRole("button", { name: "Real-Debrid cached" }));
      await screen.findByText("Provider cached");
    }
    await user.click(screen.getByRole("combobox", { name: "Episode" }));
    await user.click(screen.getByRole("option", { name: "Episode 3" }));
    expect(screen.getByRole("option", { name: "Episode 1" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("option", { name: "Episode 3" }).getAttribute("aria-selected")).toBe("true");
    await user.keyboard("{Escape}");
    await user.click(screen.getByRole("button", { name: "Find sources" }));
    await user.click(await screen.findByRole("button", { name: "Download 2 episodes" }));
    if (method === "torrent") {
      expect(api.searchTorrentSources).toHaveBeenLastCalledWith(expect.objectContaining({ season: 1, episode: undefined, episodes: [1, 3] }));
      expect(api.startTorrentDownload).toHaveBeenCalledWith(expect.objectContaining({
        source: expect.objectContaining({ selectedFileIndices: [0, 4] }),
        season: 1, episode: undefined, episodes: [1, 3]
      }));
    } else {
      expect(api.startRealDebridDownload).toHaveBeenCalledWith(expect.objectContaining({ season: 1, episode: undefined, episodes: [1, 3] }));
    }
    await user.click(screen.getByRole("button", { name: method === "torrent" ? "Real-Debrid cached" : "Torrent in app" }));
    await waitFor(() => expect((screen.getByRole("combobox", { name: "Episode" }) as HTMLButtonElement).disabled).toBe(false));
    expect(screen.getByRole("combobox", { name: "Episode" }).textContent).toContain("Episodes 1, 3");
    await user.click(screen.getByRole("combobox", { name: "Episode" }));
    await user.click(screen.getByRole("option", { name: "Episode 1" }));
    await user.click(screen.getByRole("option", { name: "Episode 3" }));
    await user.keyboard("{Escape}");
    expect((screen.getByRole("button", { name: "Find sources" }) as HTMLButtonElement).disabled).toBe(true);
    await user.click(screen.getByRole("combobox", { name: "Episode" }));
    await user.click(screen.getByRole("option", { name: "Entire season" }));
    expect(screen.getByRole("option", { name: "Entire season" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("option", { name: "Episode 1" }).getAttribute("aria-selected")).toBe("false");
  });

  it("shows subtitle badges without the removed filter panel", async () => {
    const api = createDiscoveryApi(false);
    api.searchTorrentSources = vi.fn().mockResolvedValue({
      ...sourceSearchResult,
      sources: [
        {
          ...sourceSearchResult.sources[0],
          id: "with-subs",
          name: "Sintel.2010.1080p.MULTiSUBS",
          audioLanguages: ["English", "Spanish"],
          advertisedSubtitleLanguages: []
        },
        {
          ...sourceSearchResult.sources[0],
          id: "unknown-subs",
          infoHash: "f".repeat(40),
          name: "Sintel.2010.1080p"
        }
      ]
    });
    window.subtitleTranslator = api;
    const user = userEvent.setup();

    renderPage();
    await user.click((await screen.findAllByRole("button", { name: /Sintel/ }))[0]);
    await screen.findByRole("dialog", { name: "Title details" });
    expect(await screen.findByText("Subs advertised")).toBeTruthy();
    expect(screen.getByText("English").getAttribute("title")).toBe("Audio languages: English, Spanish");
    expect(screen.queryByText("Spanish")).toBeNull();
    expect(screen.getByText("Sintel.2010.1080p")).toBeTruthy();
    expect(screen.getByText("Sintel.2010.1080p.MULTiSUBS")).toBeTruthy();
    expect(screen.queryByRole("checkbox", { name: /Advertised subtitles only/ })).toBeNull();
  });

  it("sorts torrent and Real-Debrid sources by resolution before size", async () => {
    const smallSource: TorrentSource = {
      ...sourceSearchResult.sources[0],
      id: "small",
      name: "Small source",
      sizeBytes: 1 * 1024 ** 3,
      quality: "1080p",
      providerClaimedCached: true,
      cacheStatus: "provider-claimed-cached"
    };
    const largeSource: TorrentSource = {
      ...smallSource,
      id: "large",
      name: "Large source",
      sizeBytes: 9 * 1024 ** 3,
      quality: "720p"
    };
    const unknownSource: TorrentSource = {
      ...smallSource,
      id: "unknown",
      name: "Unknown-size source",
      sizeBytes: undefined
    };
    const highResolutionSource: TorrentSource = {
      ...smallSource,
      id: "high-resolution",
      name: "High-resolution source",
      sizeBytes: 2 * 1024 ** 3,
      quality: "2160p"
    };
    const largerHighResolutionSource: TorrentSource = {
      ...highResolutionSource,
      id: "larger-high-resolution",
      name: "Larger high-resolution source",
      sizeBytes: 4 * 1024 ** 3
    };
    const unsortedSources = [largeSource, unknownSource, highResolutionSource, smallSource, largerHighResolutionSource];
    const api = createDiscoveryApi(true);
    vi.mocked(api.searchTorrentSources).mockResolvedValue({
      ...sourceSearchResult,
      sources: unsortedSources
    });
    vi.mocked(api.getVerifiedRealDebridSources).mockResolvedValue(unsortedSources);
    window.subtitleTranslator = api;
    const user = userEvent.setup();

    renderPage();

    await user.click((await screen.findAllByRole("button", { name: /Sintel/ }))[0]);
    const sourcePanel = (await screen.findByRole("heading", { name: "Download sources" }))
      .closest("section");
    expect(sourcePanel).toBeTruthy();
    await screen.findByText("Small source");

    const renderedNames = () => Array.from(
      sourcePanel!.querySelectorAll(".source-title > strong")
    ).map((element) => element.textContent);

    const expectedOrder = [
      "Larger high-resolution source", "High-resolution source", "Small source",
      "Unknown-size source", "Large source"
    ];
    expect(renderedNames()).toEqual(expectedOrder);

    await user.click(screen.getByRole("button", { name: "Real-Debrid cached" }));
    await waitFor(() => expect(api.getVerifiedRealDebridSources).toHaveBeenCalled());
    expect(renderedNames()).toEqual(expectedOrder);
  });

  it("refreshes the watched collection after a completed Real-Debrid movie download", async () => {
    const providerSource: TorrentSource = {
      ...sourceSearchResult.sources[0],
      providerClaimedCached: true,
      cacheStatus: "provider-claimed-cached"
    };
    let downloadCompleted = false;
    const api = createDiscoveryApi(true);
    api.getDownloadLocations = vi.fn().mockResolvedValue({
      defaultLocationId: "internal",
      scannedAt: "2026-07-17T00:00:00.000Z",
      locations: [
        {
          id: "internal",
          label: "Internal",
          path: "D:\\Downloads",
          isExternal: false,
          isAvailable: true,
          isDefault: true,
          createdAt: "2026-07-17T00:00:00.000Z",
          updatedAt: "2026-07-17T00:00:00.000Z"
        },
        {
          id: "tv-drive",
          label: "TV Drive",
          path: "E:\\Media",
          isExternal: true,
          isAvailable: true,
          isDefault: false,
          createdAt: "2026-07-17T00:00:00.000Z",
          updatedAt: "2026-07-17T00:00:00.000Z"
        }
      ]
    });
    api.getDiscoveryState = vi.fn(async () => ({
      preferences,
      interactions: downloadCompleted ? [{
        key: "movie:tt1727587",
        item: sintel,
        liked: false,
        disliked: false,
        watched: true,
        watchedEpisodes: [],
        watchedManually: false,
        watchlisted: false,
        hidden: false,
        updatedAt: "2026-07-17T00:00:00.000Z"
      }] : []
    }));
    vi.mocked(api.searchTorrentSources).mockResolvedValue({
      ...sourceSearchResult,
      sources: [providerSource]
    });
    vi.mocked(api.getVerifiedRealDebridSources).mockResolvedValue([providerSource]);
    api.startRealDebridDownload = vi.fn(async () => {
      downloadCompleted = true;
      return "D:\\Downloads\\Sintel.mkv";
    });
    window.subtitleTranslator = api;
    const user = userEvent.setup();

    renderPage();

    await user.click((await screen.findAllByRole("button", { name: /Sintel/ }))[0]);
    await user.click(await screen.findByRole("button", { name: "Real-Debrid cached" }));
    await user.selectOptions(screen.getByRole("combobox", { name: "Download destination" }), "tv-drive");
    await user.click(await screen.findByRole("button", { name: "Download" }));

    await waitFor(() => expect(api.startRealDebridDownload).toHaveBeenCalled());
    expect(api.startRealDebridDownload).toHaveBeenCalledWith(expect.objectContaining({
      destinationLocationId: "tv-drive"
    }));
    expect(await screen.findByText("Download completed: D:\\Downloads\\Sintel.mkv")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Watched (1)" })).toBeTruthy();
  });

  it("removes a stale provider-cached source instead of showing the raw IPC error", async () => {
    const providerSource: TorrentSource = {
      ...sourceSearchResult.sources[0],
      providerClaimedCached: true,
      cacheStatus: "provider-claimed-cached"
    };
    const api = createDiscoveryApi(true);
    vi.mocked(api.searchTorrentSources).mockResolvedValue({
      ...sourceSearchResult,
      sources: [providerSource]
    });
    vi.mocked(api.getVerifiedRealDebridSources).mockResolvedValue([providerSource]);
    api.startRealDebridDownload = vi.fn().mockRejectedValue(new Error(
      "Error invoking remote method 'discovery:download:start': Error: "
      + "The provider cache claim is stale; Real-Debrid could not make the file available immediately. Last status: error."
    ));
    window.subtitleTranslator = api;
    const user = userEvent.setup();

    renderPage();

    await user.click((await screen.findAllByRole("button", { name: /Sintel/ }))[0]);
    await user.click(await screen.findByRole("button", { name: "Real-Debrid cached" }));
    await user.click(await screen.findByRole("button", { name: "Download" }));

    expect(await screen.findByText(
      "That source is no longer cached by Real-Debrid, so it was removed. Choose another cached source."
    )).toBeTruthy();
    expect(screen.getByText("No cached sources found.")).toBeTruthy();
    expect(screen.queryByText(/Error invoking remote method/)).toBeNull();
    expect(screen.queryByRole("button", { name: "Download" })).toBeNull();

    await user.click(screen.getByRole("button", { name: "Torrent in app" }));
    await user.click(screen.getByRole("button", { name: "Real-Debrid cached" }));
    expect(await screen.findByText("No cached sources found.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Download" })).toBeNull();
  });
});

function renderPage(): void {
  render(createElement(StrictMode, null, createElement(DiscoverPage)));
}

function createDeferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve;
  });
  return { promise, resolve };
}

function createDiscoveryApi(hasRealDebridToken: boolean): SubtitleTranslatorApi {
  const savedInteractions = new Map<string, DiscoveryInteraction>();
  const downloadLocations = {
    defaultLocationId: "downloads",
    scannedAt: "2026-07-17T00:00:00.000Z",
    locations: [{
      id: "downloads",
      label: "Downloads",
      path: "D:\\Downloads",
      isExternal: false,
      isAvailable: true,
      isDefault: true,
      createdAt: "2026-07-17T00:00:00.000Z",
      updatedAt: "2026-07-17T00:00:00.000Z",
      lastSeenAt: "2026-07-17T00:00:00.000Z"
    }]
  };
  return {
    getDiscoveryState: vi.fn().mockResolvedValue({ preferences, interactions: [] }),
    getDiscoveryCredentialStatus: vi.fn().mockResolvedValue({
      hasRealDebridToken,
      hasMdblistApiKey: false
    }),
    getTorrentClientStatus: vi.fn().mockResolvedValue({ available: true, applicationName: "Test client" }),
    getDownloadLocations: vi.fn().mockResolvedValue(downloadLocations),
    addDownloadLocation: vi.fn().mockResolvedValue(downloadLocations),
    setDefaultDownloadLocation: vi.fn().mockResolvedValue(downloadLocations),
    setDownloadLocationExternal: vi.fn().mockResolvedValue(downloadLocations),
    removeDownloadLocation: vi.fn().mockResolvedValue(downloadLocations),
    scanExternalDownloadLocations: vi.fn().mockResolvedValue(downloadLocations),
    getDiscoveryHome: vi.fn().mockResolvedValue({
      generatedAt: "2026-07-17T00:00:00.000Z",
      sections: [{ id: "open-films", title: "Open films", items: [sintel] }]
    }),
    getRealDebridStatus: vi.fn().mockResolvedValue({ connected: hasRealDebridToken }),
    onDiscoveryDownloadProgress: vi.fn(() => () => undefined),
    searchDiscoveryCatalog: vi.fn().mockResolvedValue([sintel]),
    getDiscoveryDetails: vi.fn().mockResolvedValue(sintelDetails),
    setDiscoveryEpisodeWatched: vi.fn().mockResolvedValue({
      key: `movie:${sintel.id}`,
      item: sintel,
      liked: false,
      disliked: false,
      watched: false,
      watchedEpisodes: [],
      watchedManually: false,
      watchlisted: false,
      hidden: false,
      updatedAt: "2026-07-17T00:00:00.000Z"
    }),
    getDiscoveryStreamingAvailability: vi.fn().mockResolvedValue({
      entries: [],
      checkedItems: 0,
      failedItems: 0
    }),
    getDiscoveryStreamingCatalogue: vi.fn().mockResolvedValue({
      items: [],
      nextSkip: 100,
      hasMore: false,
      scannedItems: 0,
      failedItems: 0
    }),
    getDiscoveryRatings: vi.fn().mockResolvedValue({
      entries: [],
      checkedItems: 0,
      failedItems: 0
    }),
    setMdblistApiKey: vi.fn().mockResolvedValue(undefined),
    clearMdblistApiKey: vi.fn().mockResolvedValue(undefined),
    openMdblistApiKeyPage: vi.fn().mockResolvedValue(undefined),
    setDiscoveryInteraction: vi.fn(async (
      item: CatalogItem,
      action: DiscoveryAction,
      active: boolean
    ) => {
      const key = `${item.mediaType}:${item.id}`;
      const existing = savedInteractions.get(key);
      const saved: DiscoveryInteraction = {
        key,
        item,
        liked: existing?.liked ?? false,
        disliked: existing?.disliked ?? false,
        watched: existing?.watched ?? false,
        watchedEpisodes: existing?.watchedEpisodes ?? [],
        knownEpisodeCount: existing?.knownEpisodeCount,
        watchedManually: existing?.watchedManually ?? false,
        watchlisted: existing?.watchlisted ?? false,
        hidden: existing?.hidden ?? false,
        updatedAt: "2026-07-17T00:00:00.000Z"
      };
      saved[action] = active;
      savedInteractions.set(key, saved);
      return saved;
    }),
    searchTorrentSources: vi.fn().mockResolvedValue(sourceSearchResult),
    getVerifiedRealDebridSources: vi.fn().mockResolvedValue([]),
    openTorrentSource: vi.fn().mockResolvedValue(true),
    startTorrentDownload: vi.fn().mockResolvedValue("D:\\Downloads\\TV Shows\\Test Show\\Season 01"),
    cancelTorrentDownload: vi.fn().mockResolvedValue(undefined),
    startRealDebridDownload: vi.fn().mockResolvedValue(undefined),
    cancelRealDebridDownload: vi.fn().mockResolvedValue(undefined),
    openDiscoveryTrailer: vi.fn().mockResolvedValue(undefined),
    saveDiscoveryPreferences: vi.fn(async (next: DiscoveryPreferences) => next),
    setRealDebridApiToken: vi.fn().mockResolvedValue({ connected: true }),
    clearRealDebridApiToken: vi.fn().mockResolvedValue(undefined),
    clearDiscoveryInteractions: vi.fn().mockResolvedValue(undefined),
    chooseDiscoveryDownloadDirectory: vi.fn().mockResolvedValue(undefined)
  } as unknown as SubtitleTranslatorApi;
}
