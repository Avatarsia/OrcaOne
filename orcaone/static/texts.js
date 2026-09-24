// The texts of OrcaOne: German in texts/de.js, English in texts/en.js. The language is the one chosen
// at the bottom of the menu (data/settings.json, GET /api/settings), else the browser's. The
// pages take T from here; a key English lacks shows in German. Changing the language reloads the
// page, since the pages read their texts once when they load. The settings are read here once,
// before anything shows; app.js takes the folded menu from SETTINGS.
import DE from "./texts/de.js";
import EN from "./texts/en.js";
import { api } from "./api.js";

export { plainName } from "./texts/names.js";

// Each language by its own name.
export const LANGUAGES = [{ code: "de", name: "Deutsch" }, { code: "en", name: "English" }];

async function stored() {
  try {
    return await api.settings();
  } catch {
    // OrcaOne does not answer: the page shows that in the browser's language.
    return {};
  }
}
export const SETTINGS = await stored();

const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
function over(base, top) {
  const out = { ...base };
  for (const [key, value] of Object.entries(top)) out[key] = isObject(value) && isObject(base[key]) ? over(base[key], value) : value;
  return out;
}

export const LANG = LANGUAGES.some((l) => l.code === SETTINGS.language) ? SETTINGS.language
  : (navigator.language || "").toLowerCase().startsWith("de") ? "de" : "en";
export const T = LANG === "en" ? over(DE, EN) : DE;
