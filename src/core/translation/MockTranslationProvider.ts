import { TranslationProvider, TranslationRequest, TranslationResult } from "./TranslationProvider";

export class MockTranslationProvider implements TranslationProvider {
  name = "Mock Provider";

  async translateChunk(request: TranslationRequest, signal: AbortSignal): Promise<TranslationResult> {
    if (signal.aborted) {
      throw new DOMException("Translation cancelled.", "AbortError");
    }

    return {
      translations: request.targetLines.map((line) => ({
        id: line.id,
        translation: `[BG] ${line.text}`
      })),
      warnings: []
    };
  }
}
