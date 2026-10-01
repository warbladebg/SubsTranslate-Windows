import { errorMessage } from "../util/errors";
export function isRecoverableQuotaOrCreditError(error: unknown): boolean {
  const message = errorMessage(error);
  return /(?:\b402\b|\b429\b|resource[_ -]?exhausted|quota|safety cap|insufficient (?:credits?|funds?)|credits? (?:exhausted|depleted|required)|billing|payment required)/i.test(
    message
  );
}
