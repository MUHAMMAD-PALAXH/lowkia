/**
 * Translate API response messages by English canonical text.
 * Unknown strings pass through unchanged (safe default).
 *
 * Usage: const { t } = require('../utils/i18n');
 *        t(req, 'Permission denied.')
 *        t(req, 'Hello {name}', { name: 'A' })
 */
const { resolveLocale } = require("./resolveLocale");

/** @type {Record<string, Record<string, string>>} */
let catalogs = { en: {} };

try {
  catalogs = require("./catalogs");
} catch (_) {
  catalogs = { en: {} };
}

function interpolate(template, params) {
  if (!params || typeof template !== "string") return template;
  return template.replace(/\{(\w+)\}/g, (_, key) =>
    params[key] != null ? String(params[key]) : `{${key}}`
  );
}

/**
 * @param {import('express').Request|string|null} reqOrLocale
 * @param {string} english
 * @param {Record<string, string|number>|null} [params]
 */
function t(reqOrLocale, english, params = null) {
  if (english == null) return english;
  const text = String(english);
  if (!text) return text;

  const locale =
    typeof reqOrLocale === "string"
      ? reqOrLocale
      : resolveLocale(reqOrLocale);

  if (locale === "en") {
    return interpolate(text, params);
  }

  const pack = catalogs[locale] || {};
  const translated = pack[text];
  if (translated && translated !== text) {
    return interpolate(translated, params);
  }

  return interpolate(text, params);
}

/**
 * Localize a flat errors map { field: "English msg" }.
 */
function tErrors(reqOrLocale, errors) {
  if (!errors || typeof errors !== "object") return errors;
  const out = {};
  for (const [k, v] of Object.entries(errors)) {
    out[k] = typeof v === "string" ? t(reqOrLocale, v) : v;
  }
  return out;
}

module.exports = {
  t,
  tErrors,
  catalogs,
};
