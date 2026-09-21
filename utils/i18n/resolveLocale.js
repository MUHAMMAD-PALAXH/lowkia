/**
 * Resolve request locale for API response messages.
 * Priority: ?lang= → Accept-Language → X-Locale → en
 */
const SUPPORTED = new Set([
  "en",
  "bn",
  "ar",
  "es",
  "fr",
  "de",
  "pt",
  "ru",
  "tr",
  "zh",
  "ja",
  "ko",
  "hi",
  "ur",
  "id",
  "vi",
  "it",
  "nl",
  "th",
  "fa",
]);

function normalize(code) {
  if (!code) return null;
  const raw = String(code).trim().toLowerCase().replace("_", "-");
  if (!raw) return null;
  const primary = raw.split("-")[0];
  // zh-CN / zh-TW → zh
  if (primary === "zh") return SUPPORTED.has("zh") ? "zh" : null;
  return SUPPORTED.has(primary) ? primary : null;
}

function resolveLocale(req) {
  if (!req) return "en";

  const q =
    (req.query && (req.query.lang || req.query.locale)) ||
    null;
  const fromQuery = normalize(q);
  if (fromQuery) return fromQuery;

  const headerLocale = normalize(req.headers && req.headers["x-locale"]);
  if (headerLocale) return headerLocale;

  const accept = req.headers && req.headers["accept-language"];
  if (accept && typeof accept === "string") {
    const parts = accept.split(",");
    for (const part of parts) {
      const code = normalize(part.split(";")[0]);
      if (code) return code;
    }
  }

  return "en";
}

function localeMiddleware(req, res, next) {
  req.locale = resolveLocale(req);
  next();
}

module.exports = {
  SUPPORTED,
  normalize,
  resolveLocale,
  localeMiddleware,
};
