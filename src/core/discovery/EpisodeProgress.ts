import type { CatalogDetails, DiscoveryInteraction } from "./DiscoveryTypes";

export interface EpisodeSelection {
  season: number;
  episode: number;
}

export function resumeEpisodeSelection(
  details: CatalogDetails,
  interaction?: DiscoveryInteraction
): EpisodeSelection | undefined {
  if (details.mediaType !== "series") {
    return undefined;
  }

  const episodes = regularEpisodes(details);
  if (episodes.length === 0) {
    return { season: 1, episode: 1 };
  }
  if (interaction?.watched) {
    return episodes[episodes.length - 1];
  }

  const latestWatched = (interaction?.watchedEpisodes ?? [])
    .map(parseEpisodeKey)
    .filter((selection): selection is EpisodeSelection => Boolean(selection))
    .sort(compareEpisodes)
    .at(-1);
  if (!latestWatched) {
    return episodes[0];
  }

  return episodes.find((selection) => compareEpisodes(selection, latestWatched) > 0)
    ?? episodes[episodes.length - 1];
}

function regularEpisodes(details: CatalogDetails): EpisodeSelection[] {
  const episodeCounts = new Map<number, number>();
  for (const season of details.seasons.slice(0, 200)) {
    if (!Number.isSafeInteger(season.seasonNumber) || season.seasonNumber <= 0
      || !Number.isSafeInteger(season.episodeCount) || season.episodeCount <= 0) {
      continue;
    }
    episodeCounts.set(
      season.seasonNumber,
      Math.max(episodeCounts.get(season.seasonNumber) ?? 0, Math.min(season.episodeCount, 1_000))
    );
  }

  const episodes: EpisodeSelection[] = [];
  for (const [season, episodeCount] of [...episodeCounts].sort((left, right) => left[0] - right[0])) {
    for (let episode = 1; episode <= episodeCount && episodes.length < 10_000; episode += 1) {
      episodes.push({ season, episode });
    }
  }
  return episodes;
}

function parseEpisodeKey(value: string): EpisodeSelection | undefined {
  const match = /^s([1-9]\d{0,3})e([1-9]\d{0,3})$/.exec(value);
  return match ? { season: Number(match[1]), episode: Number(match[2]) } : undefined;
}

function compareEpisodes(left: EpisodeSelection, right: EpisodeSelection): number {
  return left.season - right.season || left.episode - right.episode;
}
