import type { CatalogItem, DiscoveryInteraction, MediaType } from "./DiscoveryTypes";
import { catalogItemKey } from "./DiscoveryTypes";

interface ScoredItem {
  item: CatalogItem;
  score: number;
}

interface WeightedReference {
  item: CatalogItem;
  weight: number;
}

interface TasteProfile {
  positiveReferences: WeightedReference[];
  negativeReferences: WeightedReference[];
  genreWeights: Map<number, number>;
  mediaTypeWeights: Map<MediaType, number>;
  languageWeights: Map<string, number>;
  maxGenreWeight: number;
  maxMediaTypeWeight: number;
  maxLanguageWeight: number;
}

const LIKE_WEIGHT = 3.2;
const FAVOURITE_WEIGHT = 2.4;
const WATCHED_WEIGHT = 1.4;
const DISLIKE_WEIGHT = 4;
const HIDDEN_WEIGHT = 2.4;

export function rankRecommendations(
  candidates: CatalogItem[],
  interactions: DiscoveryInteraction[],
  limit = 30,
  now = new Date()
): CatalogItem[] {
  const byKey = new Map<string, CatalogItem>();
  for (const candidate of candidates) {
    byKey.set(catalogItemKey(candidate), candidate);
  }

  const interactionMap = new Map(interactions.map((interaction) => [interaction.key, interaction]));
  const tasteProfile = buildTasteProfile(interactions, now);
  const maxPopularity = Math.max(1, ...[...byKey.values()].map((item) => item.popularity || 0));
  const scored: ScoredItem[] = [...byKey.values()]
    .filter((item) => {
      const interaction = interactionMap.get(catalogItemKey(item));
      return !interaction?.hidden && !interaction?.disliked;
    })
    .map((item) => {
      const interaction = interactionMap.get(catalogItemKey(item));
      const rating = ratingQuality(item);
      const popularity = clamp01(Math.log1p(Math.max(0, item.popularity)) / Math.log1p(maxPopularity));
      const freshness = releaseFreshness(item.releaseDate, now);
      const genreAffinity = averageAffinity(item.genreIds, tasteProfile.genreWeights, tasteProfile.maxGenreWeight);
      const mediaTypeAffinity = normalizedAffinity(
        tasteProfile.mediaTypeWeights.get(item.mediaType) ?? 0,
        tasteProfile.maxMediaTypeWeight
      );
      const languageAffinity = item.originalLanguage
        ? normalizedAffinity(
          tasteProfile.languageWeights.get(item.originalLanguage.toLowerCase()) ?? 0,
          tasteProfile.maxLanguageWeight
        )
        : 0;
      const positiveSimilarity = weightedSimilarity(item, tasteProfile.positiveReferences, 4);
      const negativeSimilarity = weightedSimilarity(item, tasteProfile.negativeReferences, 3);
      const score =
        rating * 0.32 +
        popularity * 0.23 +
        freshness * 0.13 +
        genreAffinity * 0.34 +
        positiveSimilarity * 0.28 +
        mediaTypeAffinity * 0.08 +
        languageAffinity * 0.04 -
        negativeSimilarity * 0.42 +
        directInteractionAdjustment(interaction);
      return { item, score };
    })
    .sort((left, right) =>
      right.score - left.score
      || right.item.voteCount - left.item.voteCount
      || right.item.popularity - left.item.popularity
      || left.item.title.localeCompare(right.item.title)
      || catalogItemKey(left.item).localeCompare(catalogItemKey(right.item))
    );

  const safeLimit = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : 0;
  return diversify(scored, safeLimit);
}

export function recommendationSignalStrength(
  interaction: DiscoveryInteraction,
  now = new Date()
): number {
  if (interaction.disliked || interaction.hidden) {
    return 0;
  }
  let weight = 0;
  if (interaction.liked) {
    weight += LIKE_WEIGHT;
  }
  if (interaction.watchlisted) {
    weight += FAVOURITE_WEIGHT;
  }
  if (interaction.watched) {
    weight += WATCHED_WEIGHT;
  } else {
    const progress = watchedProgress(interaction);
    if (progress > 0) {
      weight += 0.35 + progress * 0.9;
    }
  }
  return weight * interactionRecency(interaction.updatedAt, now);
}

export function hasRecommendationSignal(interaction: DiscoveryInteraction): boolean {
  return interaction.disliked
    || interaction.hidden
    || recommendationSignalStrength(interaction) > 0;
}

function buildTasteProfile(interactions: DiscoveryInteraction[], now: Date): TasteProfile {
  const positiveReferences: WeightedReference[] = [];
  const negativeReferences: WeightedReference[] = [];
  const genreWeights = new Map<number, number>();
  const mediaTypeWeights = new Map<MediaType, number>();
  const languageWeights = new Map<string, number>();

  for (const interaction of interactions) {
    const positiveWeight = recommendationSignalStrength(interaction, now);
    const negativeWeight = negativeSignalStrength(interaction, now);
    if (positiveWeight > 0) {
      positiveReferences.push({ item: interaction.item, weight: positiveWeight });
    }
    if (negativeWeight > 0) {
      negativeReferences.push({ item: interaction.item, weight: negativeWeight });
    }
    const netWeight = positiveWeight - negativeWeight;
    if (netWeight === 0) {
      continue;
    }
    for (const genreId of new Set(interaction.item.genreIds)) {
      addWeight(genreWeights, genreId, netWeight);
    }
    addWeight(mediaTypeWeights, interaction.item.mediaType, netWeight);
    if (interaction.item.originalLanguage) {
      addWeight(languageWeights, interaction.item.originalLanguage.toLowerCase(), netWeight);
    }
  }

  return {
    positiveReferences,
    negativeReferences,
    genreWeights,
    mediaTypeWeights,
    languageWeights,
    maxGenreWeight: maxAbsoluteWeight(genreWeights),
    maxMediaTypeWeight: maxAbsoluteWeight(mediaTypeWeights),
    maxLanguageWeight: maxAbsoluteWeight(languageWeights)
  };
}

function negativeSignalStrength(interaction: DiscoveryInteraction, now: Date): number {
  let weight = 0;
  if (interaction.disliked) {
    weight += DISLIKE_WEIGHT;
  }
  if (interaction.hidden) {
    weight += HIDDEN_WEIGHT;
  }
  return weight * interactionRecency(interaction.updatedAt, now);
}

function directInteractionAdjustment(interaction: DiscoveryInteraction | undefined): number {
  if (!interaction) {
    return 0;
  }
  let adjustment = 0;
  if (interaction.watched) {
    adjustment -= 0.9;
  } else {
    const progress = watchedProgress(interaction);
    if (progress > 0) {
      adjustment -= 0.2 + progress * 0.3;
    }
  }
  if (interaction.liked) {
    adjustment -= 0.3;
  }
  if (interaction.watchlisted) {
    adjustment -= 0.12;
  }
  return adjustment;
}

function watchedProgress(interaction: DiscoveryInteraction): number {
  const watchedEpisodes = new Set(interaction.watchedEpisodes ?? []).size;
  if (watchedEpisodes === 0) {
    return 0;
  }
  return interaction.knownEpisodeCount && interaction.knownEpisodeCount > 0
    ? clamp01(watchedEpisodes / interaction.knownEpisodeCount)
    : 0.35;
}

function interactionRecency(updatedAt: string, now: Date): number {
  const timestamp = Date.parse(updatedAt);
  if (!Number.isFinite(timestamp)) {
    return 0.75;
  }
  const ageDays = Math.max(0, (now.getTime() - timestamp) / (24 * 60 * 60 * 1_000));
  return 0.6 + 0.4 * Math.exp(-ageDays / 365);
}

function ratingQuality(item: CatalogItem): number {
  const rating = clamp01(item.voteAverage / 10);
  const confidence = item.voteCount > 0
    ? clamp01(Math.log10(item.voteCount + 1) / 4.5)
    : 0.45;
  return rating * (0.55 + confidence * 0.45);
}

function diversify(scored: ScoredItem[], limit: number): CatalogItem[] {
  const selected: ScoredItem[] = [];
  const remaining = scored.map((candidate) => ({ ...candidate, redundancy: 0 }));
  while (selected.length < limit && remaining.length > 0) {
    let bestIndex = 0;
    let bestScore = Number.NEGATIVE_INFINITY;
    for (let index = 0; index < remaining.length; index += 1) {
      const candidate = remaining[index];
      const diversifiedScore = candidate.score - candidate.redundancy * 0.16;
      if (diversifiedScore > bestScore) {
        bestScore = diversifiedScore;
        bestIndex = index;
      }
    }
    const chosen = remaining.splice(bestIndex, 1)[0];
    selected.push(chosen);
    if (selected.length < limit) {
      for (const candidate of remaining) {
        candidate.redundancy = Math.max(candidate.redundancy, catalogItemSimilarity(candidate.item, chosen.item));
      }
    }
  }
  return selected.map(({ item }) => item);
}

function weightedSimilarity(item: CatalogItem, references: WeightedReference[], take: number): number {
  const closest: Array<{ similarity: number; weight: number }> = [];
  for (const reference of references) {
    const similarity = catalogItemSimilarity(item, reference.item);
    if (similarity <= 0 || reference.weight <= 0) continue;
    const score = similarity * reference.weight;
    const index = closest.findIndex((match) => score > match.similarity * match.weight);
    if (index !== -1) closest.splice(index, 0, { similarity, weight: reference.weight });
    else if (closest.length < take) closest.push({ similarity, weight: reference.weight });
    if (closest.length > take) closest.pop();
  }
  const totalWeight = closest.reduce((total, match) => total + match.weight, 0);
  return totalWeight > 0
    ? closest.reduce((total, match) => total + match.similarity * match.weight, 0) / totalWeight
    : 0;
}

function catalogItemSimilarity(left: CatalogItem, right: CatalogItem): number {
  const genres = genreSimilarity(left, right);
  const mediaType = left.mediaType === right.mediaType ? 1 : 0;
  const language = left.originalLanguage && right.originalLanguage
    && left.originalLanguage.toLowerCase() === right.originalLanguage.toLowerCase()
    ? 1
    : 0;
  return genres * 0.82 + mediaType * 0.13 + language * 0.05;
}

function genreSimilarity(left: CatalogItem, right: CatalogItem): number {
  const leftGenres = new Set(left.genreIds);
  const rightGenres = new Set(right.genreIds);
  if (leftGenres.size === 0 || rightGenres.size === 0) {
    return 0;
  }
  let intersection = 0;
  for (const genre of leftGenres) {
    if (rightGenres.has(genre)) intersection++;
  }
  const union = leftGenres.size + rightGenres.size - intersection;
  return intersection / union;
}

function averageAffinity<T>(values: T[], weights: Map<T, number>, maximum: number): number {
  const uniqueValues = [...new Set(values)];
  if (uniqueValues.length === 0 || maximum <= 0) {
    return 0;
  }
  return uniqueValues.reduce((total, value) => total + normalizedAffinity(weights.get(value) ?? 0, maximum), 0)
    / uniqueValues.length;
}

function normalizedAffinity(value: number, maximum: number): number {
  return maximum > 0 ? Math.max(-1, Math.min(1, value / maximum)) : 0;
}

function addWeight<T>(weights: Map<T, number>, key: T, weight: number): void {
  weights.set(key, (weights.get(key) ?? 0) + weight);
}

function maxAbsoluteWeight<T>(weights: Map<T, number>): number {
  return Math.max(0, ...[...weights.values()].map((weight) => Math.abs(weight)));
}

function releaseFreshness(releaseDate: string | undefined, now: Date): number {
  if (!releaseDate) {
    return 0.35;
  }
  const released = new Date(releaseDate);
  if (!Number.isFinite(released.getTime())) {
    return 0.35;
  }
  const ageYears = Math.max(0, (now.getTime() - released.getTime()) / (365.25 * 24 * 60 * 60 * 1000));
  return Math.exp(-ageYears / 12);
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}
