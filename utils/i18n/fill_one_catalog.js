/**
 * Fill one locale: node utils/i18n/fill_one_catalog.js ar
 */
const fs = require("fs");
const path = require("path");
const { PRIORITY_EN } = require("./catalogs");

const code = process.argv[2];
if (!code) {
  console.error("Usage: node utils/i18n/fill_one_catalog.js <locale>");
  process.exit(1);
}

const LANG = {
  bn: "bn", ar: "ar", es: "es", fr: "fr", de: "de", pt: "pt",
  ru: "ru", tr: "tr", zh: "zh-CN", ja: "ja", ko: "ko", hi: "hi",
  ur: "ur", id: "id", vi: "vi", it: "it", nl: "nl", th: "th", fa: "fa",
};
const tl = LANG[code];
if (!tl) {
  console.error("bad locale");
  process.exit(1);
}

function rl(a, ops) {
  let result = a;
  for (let i = 0; i < ops.length - 2; i += 3) {
    const opChar = ops.charAt(i + 2);
    const amount = opChar >= "a" ? opChar.charCodeAt(0) - 87 : Number(opChar);
    const shifted =
      ops.charAt(i + 1) === "+" ? result >>> amount : result << amount;
    result = ops.charAt(i) === "+" ? result + shifted : result ^ shifted;
  }
  return result;
}
const TKK = [406398, 2087938574];
function generateToken(text) {
  const bytes = Buffer.from(text, "utf8");
  let a = TKK[0];
  for (const byte of bytes) a = rl(a + byte, "+-a^+6");
  a = rl(a, "+-3^+b+-f");
  a = a ^ TKK[1];
  if (a < 0) a = (a & 2147483647) + 2147483648;
  a = a % 1e6;
  return `${a}.${a ^ TKK[0]}`;
}
function parseGoogleResponse(data) {
  if (!Array.isArray(data) || !Array.isArray(data[0])) return "";
  let result = "";
  for (const item of data[0]) {
    if (Array.isArray(item) && typeof item[0] === "string") result += item[0];
  }
  return result;
}
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function googleTranslate(text) {
  const url = new URL("https://translate.google.com/translate_a/single");
  url.searchParams.set("client", "webapp");
  url.searchParams.set("sl", "en");
  url.searchParams.set("tl", tl);
  url.searchParams.set("dt", "t");
  url.searchParams.set("tk", generateToken(text));
  url.searchParams.set("q", text);
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      const response = await fetch(url.toString(), {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        },
      });
      if (response.status === 429 || response.status === 503) {
        await sleep(2000 * Math.pow(2, attempt));
        continue;
      }
      if (!response.ok) throw new Error("HTTP " + response.status);
      const data = await response.json();
      return parseGoogleResponse(data).trim() || text;
    } catch (_) {
      await sleep(400 * (attempt + 1));
    }
  }
  return text;
}

(async () => {
  const dir = path.join(__dirname, "locales");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${code}.json`);
  let pack = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {};
  let changed = 0;
  // batch 10 lines
  const pending = PRIORITY_EN.filter((t) => !pack[t] || pack[t] === t);
  for (let i = 0; i < pending.length; i += 10) {
    const chunk = pending.slice(i, i + 10);
    const joined = chunk.join("\n");
    let parts;
    try {
      const tr = await googleTranslate(joined);
      parts = tr.split(/\r?\n/);
      if (parts.length !== chunk.length) parts = null;
    } catch (_) {
      parts = null;
    }
    if (!parts) {
      parts = [];
      for (const line of chunk) {
        parts.push(await googleTranslate(line));
        await sleep(60);
      }
    }
    for (let j = 0; j < chunk.length; j++) {
      if (parts[j] && parts[j] !== chunk[j]) {
        pack[chunk[j]] = parts[j];
        changed++;
      }
    }
    fs.writeFileSync(file, JSON.stringify(pack, null, 2) + "\n");
    process.stdout.write(`\r${code} ${Math.min(i + 10, pending.length)}/${pending.length} +${changed}  `);
    await sleep(150);
  }
  console.log(`\nDONE ${code} changed=${changed}`);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
