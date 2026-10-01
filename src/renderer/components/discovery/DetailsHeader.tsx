import { useCallback, useRef, useState } from "react";
import { Bookmark, Eye, EyeOff, Film, Play, Star, ThumbsDown, ThumbsUp, Tv } from "lucide-react";
import type { CatalogDetails, CatalogItem, DiscoveryAction, DiscoveryInteraction, ExternalRating } from "../../../core/discovery/DiscoveryTypes";
import { catalogItemKey } from "../../../core/discovery/DiscoveryTypes";
import { MultiSourceRatingBadges } from "./MultiSourceRatingBadges";
import { InteractionButton, Poster } from "./CatalogPrimitives";
import { TrailerHero } from "./TrailerHero";

export function DetailsHeader({
  details,
  interaction,
  busyAction,
  ratings,
  onInteract
}: {
  details: CatalogDetails;
  interaction?: DiscoveryInteraction;
  busyAction: string;
  ratings: ExternalRating[];
  onInteract: (item: CatalogItem, action: DiscoveryAction) => void;
}) {
  const trailer = details.videos.find((video) => video.site === "YouTube" && video.type === "Trailer" && video.official)
    ?? details.videos.find((video) => video.site === "YouTube" && video.type === "Trailer");
  // Keyed by trailer, so opening another title never starts playing on its own.
  const [playingKey, setPlayingKey] = useState<string>();
  const playing = Boolean(trailer) && playingKey === trailer?.key;
  const heroRef = useRef<HTMLDivElement>(null);
  const stopTrailer = useCallback(() => setPlayingKey(undefined), []);
  const playTrailer = (): void => {
    if (!trailer) return;
    setPlayingKey(trailer.key);
    heroRef.current?.scrollIntoView({ block: "start", behavior: "smooth" });
  };
  const [failedImages, setFailedImages] = useState<string[]>([]);
  const markImageFailed = useCallback((source: string) => setFailedImages((failed) => [...failed, source]), []);
  // Without a backdrop, the trailer's own thumbnail stands in for one.
  const backdrop = [details.backdropPath, trailer && `https://i.ytimg.com/vi/${trailer.key}/hqdefault.jpg`]
    .find((source): source is string => Boolean(source) && !failedImages.includes(source!));
  const hasHero = Boolean(backdrop || trailer);
  return (
    <div className="details-content">
      <TrailerHero
        heroRef={heroRef}
        title={details.title}
        backdrop={backdrop}
        trailer={trailer}
        playing={playing}
        onPlay={playTrailer}
        onStop={stopTrailer}
        onBackdropError={markImageFailed}
      />
      <div className={`details-title-row${hasHero && !playing ? "" : " no-backdrop"}`}>
        <Poster item={details} size="large" />
        <div>
          <span className="discover-eyebrow">
            {details.mediaType === "movie" ? <Film size={14} /> : <Tv size={14} />}
            {details.mediaType === "movie" ? "Movie" : "TV series"}
          </span>
          <h2>{details.title}</h2>
          {details.tagline && <p className="details-tagline">{details.tagline}</p>}
          <div className="details-metrics">
            <span><Star size={14} /> {details.voteAverage ? details.voteAverage.toFixed(1) : "Not rated"}</span>
            <span>{details.releaseDate?.slice(0, 4) || "Year unknown"}</span>
            {details.runtimeMinutes && <span>{details.runtimeMinutes} min</span>}
          </div>
          <MultiSourceRatingBadges ratings={ratings} />
        </div>
      </div>
      <div className="details-genres">
        {details.genres.map((genre) => <span key={genre.id}>{genre.name}</span>)}
      </div>
      <p className="details-overview">{details.overview || "No overview is available."}</p>
      {details.cast.length > 0 && (
        <p className="details-cast"><strong>Cast:</strong> {details.cast.slice(0, 8).map((person) => person.name).join(", ")}</p>
      )}
      <div className="details-actions">
        <InteractionButton
          active={interaction?.liked}
          busy={busyAction === `${catalogItemKey(details)}:liked`}
          label="Like"
          icon={<ThumbsUp size={15} />}
          onClick={() => onInteract(details, "liked")}
        />
        <InteractionButton
          active={interaction?.disliked}
          busy={busyAction === `${catalogItemKey(details)}:disliked`}
          label="Dislike"
          icon={<ThumbsDown size={15} />}
          onClick={() => onInteract(details, "disliked")}
        />
        <InteractionButton
          active={interaction?.watched}
          busy={busyAction === `${catalogItemKey(details)}:watched`}
          label="Watched"
          icon={<Eye size={15} />}
          onClick={() => onInteract(details, "watched")}
        />
        <InteractionButton
          active={interaction?.watchlisted}
          busy={busyAction === `${catalogItemKey(details)}:watchlisted`}
          label="Favourite"
          icon={<Bookmark size={15} />}
          onClick={() => onInteract(details, "watchlisted")}
        />
        <InteractionButton
          active={interaction?.hidden}
          busy={busyAction === `${catalogItemKey(details)}:hidden`}
          label="Hide"
          icon={<EyeOff size={15} />}
          onClick={() => onInteract(details, "hidden")}
        />
        {trailer && (
          <button className="text-button" onClick={playTrailer} type="button">
            <Play size={15} />
            Trailer
          </button>
        )}
      </div>
    </div>
  );
}
