import type { ExternalRating, RatingSourceId } from "../../../core/discovery/DiscoveryTypes";


const RATING_SOURCE_DETAILS: Record<RatingSourceId, { label: string; shortLabel: string }> = {
  imdb: { label: "IMDb", shortLabel: "IMDb" },
  trakt: { label: "Trakt", shortLabel: "Trakt" },
  tmdb: { label: "TMDB", shortLabel: "TMDB" },
  letterboxd: { label: "Letterboxd", shortLabel: "LB" },
  tomatoes: { label: "Rotten Tomatoes critics", shortLabel: "RT" },
  popcorn: { label: "Rotten Tomatoes audience", shortLabel: "Audience" },
  metacritic: { label: "Metacritic", shortLabel: "MC" },
  "metacritic-user": { label: "Metacritic users", shortLabel: "MC user" },
  rogerebert: { label: "Roger Ebert", shortLabel: "Ebert" },
  myanimelist: { label: "MyAnimeList", shortLabel: "MAL" }
};

const RATING_SOURCE_ORDER: RatingSourceId[] = [
  "tomatoes",
  "popcorn",
  "metacritic",
  "letterboxd",
  "trakt",
  "tmdb",
  "rogerebert",
  "metacritic-user",
  "myanimelist"
];

export function MultiSourceRatingBadges({
  ratings,
  compact = false
}: {
  ratings: ExternalRating[];
  compact?: boolean;
}) {
  const bySource = new Map(ratings.map((rating) => [rating.source, rating]));
  const visibleRatings = RATING_SOURCE_ORDER
    .flatMap((source) => {
      const rating = bySource.get(source);
      return rating ? [rating] : [];
    })
    .slice(0, compact ? 3 : undefined);
  if (visibleRatings.length === 0) {
    return null;
  }
  return (
    <span
      aria-label="Ratings from other sources"
      className={`multi-source-ratings${compact ? " compact" : ""}`}
    >
      {visibleRatings.map((rating) => {
        const source = RATING_SOURCE_DETAILS[rating.source];
        const votes = rating.votes !== undefined ? ` · ${rating.votes.toLocaleString()} ratings` : "";
        return (
          <span
            className={`rating-source-badge rating-source-${rating.source}`}
            key={rating.source}
            title={`${source.label}: ${formatExternalRating(rating)}${votes}`}
          >
            <strong>{compact ? source.shortLabel : source.label}</strong>
            {formatExternalRating(rating)}
          </span>
        );
      })}
    </span>
  );
}

function formatExternalRating(rating: ExternalRating): string {
  if (
    rating.source === "tomatoes"
    || rating.source === "popcorn"
    || rating.source === "metacritic"
    || rating.source === "trakt"
    || rating.source === "tmdb"
  ) {
    return `${Math.round(rating.value)}%`;
  }
  if (rating.source === "letterboxd") {
    return `${rating.value.toFixed(1)}/5`;
  }
  if (rating.source === "rogerebert") {
    return `${rating.value.toFixed(1)}/4`;
  }
  return `${rating.value.toFixed(1)}/10`;
}
