/// <reference types="vite/client" />

import type { SubtitleTranslatorApi } from "../preload";

declare global {
  interface Window {
    subtitleTranslator: SubtitleTranslatorApi;
  }
}
