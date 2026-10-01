import { SubtitleCue } from "./SubtitleCue";
import { rewrapSubtitleText, WrapOptions } from "./TextCleaner";

export interface SrtWriterOptions {
  rewrap?: boolean;
  wrapOptions?: WrapOptions;
}

export function writeSrt(cues: SubtitleCue[], options: SrtWriterOptions = {}): string {
  const rewrap = options.rewrap ?? true;

  return cues
    .map((cue, index) => {
      const text = rewrap ? rewrapSubtitleText(cue.text, options.wrapOptions) : cue.text.trim();
      return `${index + 1}\n${cue.startTime} --> ${cue.endTime}\n${text}`;
    })
    .join("\n\n")
    .concat("\n");
}
