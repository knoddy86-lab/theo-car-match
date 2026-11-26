// v61: every letter clip exists and is referenced; version and letters path checks.
// Run from the repo root: node tests/v61-letters.mjs
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const letters = "abcdefghijklmnopqrstuvwxyz".split("");
const failures = [];
function fail(msg) { failures.push(msg); }

for (const c of letters) {
  const p = path.join(root, "sounds", "letters", "let-" + c + ".mp3");
  if (!fs.existsSync(p)) fail("missing " + p);
  else if (fs.statSync(p).size < 500) fail("tiny " + p + " (" + fs.statSync(p).size + " bytes)");
}

const index = fs.readFileSync(path.join(root, "index.html"), "utf8");
const sw = fs.readFileSync(path.join(root, "sw.js"), "utf8");
const version = JSON.parse(fs.readFileSync(path.join(root, "version.json"), "utf8"));
if (version.version !== "61" || version.cache !== "theo-car-match-v61") fail("version.json " + JSON.stringify(version));
if (!index.includes('APP_VERSION = "61"')) fail("APP_VERSION is not 61");
if (!index.includes('SOUND_DIR + "letters/"')) fail("index.html does not point the Letters game at sounds/letters/");
if (index.includes("letters-emma/")) fail("index.html still uses letters-emma/");
if (!index.includes('letters: "alba"')) fail("default letters voice is not alba");
if (index.includes('letters: "emma"')) fail("default letters voice is still emma");
if (!index.includes("Alba and Cori")) fail("letters voice label should mention Alba and Cori");
if (!sw.includes('var CACHE = "theo-car-match-v61"')) fail("sw.js cache is not theo-car-match-v61");
if (sw.includes("letters-emma")) fail("sw.js still mentions letters-emma");
if (!sw.includes("./sounds/letters/let-")) fail("sw.js does not precache sounds/letters/");
for (const c of letters) {
  if (!sw.includes("let-" + c)) fail("sw.js does not mention let-" + c);
}
if (!index.includes('W: "Double you"') || !index.includes('Z: "Zed"')) fail("LETTER_SAY should keep W Double you and Z Zed");
const credits = fs.readFileSync(path.join(root, "sounds", "letters", "CREDITS.md"), "utf8");
if (!/Cori/i.test(credits) || !/en_GB-cori-high/.test(credits) || !/LibriVox/i.test(credits)) fail("CREDITS.md missing Piper Cori / LibriVox");
if (!/Alba/.test(credits) || !/CC BY 4.0/.test(credits)) fail("CREDITS.md missing Alba CC BY 4.0");

for (const rel of ["sounds/voice/ramone.mp3", "sounds/classic/ramone.mp3"]) {
  const p = path.join(root, rel);
  if (!fs.existsSync(p)) fail("missing " + p);
  else if (fs.statSync(p).size < 500) fail("tiny " + p);
}
if (fs.existsSync(path.join(root, "sounds", "letters-emma")) && fs.readdirSync(path.join(root, "sounds", "letters-emma")).some(function (f) { return f.endsWith(".mp3"); })) {
  fail("sounds/letters-emma still has mp3 clips");
}

if (failures.length) {
  console.error(failures.length + " failure(s):");
  failures.forEach(function (f) { console.error(" - " + f); });
  process.exit(1);
}
console.log("v61 letters file and reference checks passed (26 clips + credits + v61 pointers)");
