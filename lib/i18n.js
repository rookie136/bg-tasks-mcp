/**
 * i18n loader — reads JSON translation files from lib/i18n/.
 * Supports: en, zh. Default: en.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DIR = path.dirname(fileURLToPath(import.meta.url));

/** @type {Record<string, Record<string, string>>} */
const cache = {};

const FALLBACK = {};

function load(lang) {
  if (cache[lang]) return cache[lang];
  try {
    const raw = fs.readFileSync(path.join(DIR, "i18n", `${lang}.json`), "utf-8");
    cache[lang] = JSON.parse(raw);
    return cache[lang];
  } catch {
    // fallback to en, but avoid recursive fallback
    if (lang === "en") { cache.en = FALLBACK; return FALLBACK; }
    return load("en");
  }
}

/**
 * @param {string} lang — "en" | "zh"
 * @param {string} key
 * @param {...(string|number)} args
 * @returns {string}
 */
export function t(lang, key, ...args) {
  const msgs = load(lang);
  let v = msgs[key] || load("en")[key] || key;
  if (typeof v !== "string") v = String(key);
  args.forEach((a, i) => v = v.replace(`{${i}}`, String(a)));
  return v;
}