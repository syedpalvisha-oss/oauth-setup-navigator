// Keep in sync with client/src/lib/validateQuery.js (the client runs the same check to show the message inline).
export const MAX_QUERY_CHARS = 60;
export const FRIENDLY_FAILURE = "Couldn't generate this guide right now. Please try again in a minute.";

const NAME_RE = /^[\p{L}\p{N}][\p{L}\p{N} .,&'+_-]*$/u; // an app name: letters, digits, spaces and a little punctuation
// Path part of a URL: no whitespace and none of < > { } " ' ` \ | ^
const URL_RE = /^https?:\/\/[\p{L}\p{N}-]+(\.[\p{L}\p{N}-]+)+(:\d+)?(\/[^\s<>{}"'\x60\|^]*)?$/iu;
const DOMAIN_RE = /^[\p{L}\p{N}-]+(\.[\p{L}\p{N}-]+)+(\/[^\s<>{}"'\x60\|^]*)?$/u;

/** @returns {{ ok: true, query: string } | { ok: false, error: string }} */
export function validateQuery(input) {
  const query = typeof input === 'string' ? input.trim() : '';
  if (!query) return { ok: false, error: 'Enter an app name or website URL.' };
  if (query.length > MAX_QUERY_CHARS) return { ok: false, error: `Keep it to ${MAX_QUERY_CHARS} characters or fewer.` };
  if (!(NAME_RE.test(query) || URL_RE.test(query) || DOMAIN_RE.test(query))) {
    return { ok: false, error: "That doesn't look like an app name or website URL. Use letters, numbers and spaces, or a web address like zoom.us." };
  }
  return { ok: true, query };
}
