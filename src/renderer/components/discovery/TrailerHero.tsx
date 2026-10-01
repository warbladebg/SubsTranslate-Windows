import { useEffect, useRef, type RefObject } from "react";
import { ExternalLink, Maximize2, Play, X } from "lucide-react";
import type { CatalogVideo } from "../../../core/discovery/DiscoveryTypes";

/**
 * The top of the title details. When there is a trailer the backdrop itself is the
 * play button, and clicking it swaps the backdrop for an inline YouTube player.
 */
export function TrailerHero({
  heroRef,
  title,
  backdrop,
  trailer,
  playing,
  onPlay,
  onStop,
  onBackdropError
}: {
  heroRef: RefObject<HTMLDivElement>;
  title: string;
  /** The first artwork that has not failed to load, if any. */
  backdrop?: string;
  trailer?: CatalogVideo;
  playing: boolean;
  onPlay: () => void;
  onStop: () => void;
  onBackdropError: (source: string) => void;
}) {
  const frameRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    if (!playing) return;
    // Capture phase, so Escape stops the trailer before it closes the details drawer.
    const stopOnEscape = (event: KeyboardEvent): void => {
      if (event.key !== "Escape" || document.fullscreenElement) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      onStop();
    };
    window.addEventListener("keydown", stopOnEscape, true);
    return () => window.removeEventListener("keydown", stopOnEscape, true);
  }, [onStop, playing]);

  if (playing && trailer) {
    return (
      <div className="details-hero playing" ref={heroRef}>
        <div className="details-trailer-frame">
          <iframe
            ref={frameRef}
            src={`https://www.youtube-nocookie.com/embed/${encodeURIComponent(trailer.key)}?autoplay=1&rel=0&modestbranding=1&playsinline=1`}
            title={`${title} trailer`}
            allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
            referrerPolicy="strict-origin-when-cross-origin"
          />
        </div>
        <div className="details-trailer-bar">
          <span><Play size={13} /> Trailer</span>
          <div>
            <button className="text-button" onClick={() => void frameRef.current?.requestFullscreen()} type="button">
              <Maximize2 size={14} />
              Full screen
            </button>
            <button
              className="text-button"
              onClick={() => window.subtitleTranslator.openDiscoveryTrailer(trailer.key)}
              title="Open this trailer on YouTube in your browser"
              type="button"
            >
              <ExternalLink size={14} />
              YouTube
            </button>
            <button className="icon-button" onClick={onStop} title="Close trailer" aria-label="Close trailer" type="button">
              <X size={16} />
            </button>
          </div>
        </div>
      </div>
    );
  }

  // A trailer keeps the play target even when every artwork failed, on a plain fill.
  if (!backdrop && !trailer) return null;
  const image = backdrop ? (
    <img
      className="details-backdrop"
      src={backdrop}
      alt=""
      referrerPolicy="no-referrer"
      onError={() => onBackdropError(backdrop)}
    />
  ) : (
    <div className="details-backdrop placeholder" />
  );
  return (
    <div className="details-hero" ref={heroRef}>
      {trailer ? (
        <button className="details-backdrop-play" onClick={onPlay} aria-label={`Play the ${title} trailer`} type="button">
          {image}
          <span className="details-trailer-play" aria-hidden="true">
            <Play size={20} />
            <span>Play trailer</span>
          </span>
        </button>
      ) : image}
    </div>
  );
}
