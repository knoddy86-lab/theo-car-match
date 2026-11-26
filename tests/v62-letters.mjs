// v62: every letter clip exists and is referenced; R/F/J/K match the picked takes.
// Run from the repo root: node tests/v62-letters.mjs
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const letters = "abcdefghijklmnopqrstuvwxyz".split("");
const failures = [];
function fail(msg) { failures.push(msg); }
function sha256(p) {
  return crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
}

for (const c of letters) {
  const p = path.join(root, "sounds", "letters", "let-" + c + ".mp3");
  if (!fs.existsSync(p)) fail("missing " + p);
  else if (fs.statSync(p).size < 500) fail("tiny " + p + " (" + fs.statSync(p).size + " bytes)");
}

const expected = {
  r: "a659fc120cde652657f9314d444f0c8bdd63a5a36f4826c8e79620265476091f",
  f: "73a883a5de0152b2c210ed1c4434b6c74b5da9848be306005ebe15cecbcc4b02",
  j: "ebe9ea12fea507e2b85da580528c922a83a496538f4264fb6d5854e11e30cc17",
  k: "2fa455563f5de84f7899e0eda603c81606e140fb810d52a6bde4882564afdbaa",
};
const labels = {
  r: "R take 2 Alba (phonemes ˈɑː, ls 1.30)",
  f: "F take 1 Alba (text Ef., ls 1.20)",
  j: "J take 1 Cori (phonemes /dʒeɪ/, ls 1.25)",
  k: "K take 1 Cori (phonemes /keɪ/, ls 1.25)",
};
for (const c of Object.keys(expected)) {
  const p = path.join(root, "sounds", "letters", "let-" + c + ".mp3");
  const got = sha256(p);
  if (got !== expected[c]) fail("let-" + c + " hash " + got + " (want " + expected[c] + " — " + labels[c] + ")");
  const build = path.join(root, "sounds", "build", "let-" + c + ".mp3");
  if (!fs.existsSync(build) || sha256(build) !== expected[c]) fail("sounds/build/let-" + c + " does not match the picked letters clip");
}

const index = fs.readFileSync(path.join(root, "index.html"), "utf8");
const sw = fs.readFileSync(path.join(root, "sw.js"), "utf8");
const version = JSON.parse(fs.readFileSync(path.join(root, "version.json"), "utf8"));
if (version.version !== "62" || version.cache !== "theo-car-match-v62") fail("version.json " + JSON.stringify(version));
if (!index.includes('APP_VERSION = "62"')) fail("APP_VERSION is not 62");
if (!index.includes('SOUND_DIR + "letters/"')) fail("index.html does not point the Letters game at sounds/letters/");
if (index.includes("letters-emma/")) fail("index.html still uses letters-emma/");
if (!index.includes('letters: "alba"')) fail("default letters voice is not alba");
if (index.includes('letters: "emma"')) fail("default letters voice is still emma");
if (!index.includes("Alba and Cori")) fail("letters voice label should mention Alba and Cori");
if (!index.includes("lettersV !== 62")) fail("lettersV migration is not 62");
if (!sw.includes('var CACHE = "theo-car-match-v62"')) fail("sw.js cache is not theo-car-match-v62");
if (sw.includes("theo-car-match-v61")) fail("sw.js still names the v61 cache");
if (sw.includes("letters-emma")) fail("sw.js still mentions letters-emma");
if (!sw.includes("./sounds/letters/let-")) fail("sw.js does not precache sounds/letters/");
for (const c of letters) {
  if (!sw.includes("let-" + c)) fail("sw.js does not mention let-" + c);
}
if (!index.includes('W: "Double you"') || !index.includes('Z: "Zed"')) fail("LETTER_SAY should keep W Double you and Z Zed");
const credits = fs.readFileSync(path.join(root, "sounds", "letters", "CREDITS.md"), "utf8");
if (!/Cori/i.test(credits) || !/en_GB-cori-high/.test(credits) || !/LibriVox/i.test(credits)) fail("CREDITS.md missing Piper Cori / LibriVox");
if (!/Alba/.test(credits) || !/CC BY 4.0/.test(credits)) fail("CREDITS.md missing Alba CC BY 4.0");
if (!/L, I, J and K/i.test(credits) && !/L, I, J, and K/i.test(credits) && !/J and K/.test(credits)) {
  fail("CREDITS.md should say Cori is used for L, I, J and K");
}
if (!/including R and F/i.test(credits) && !/R and F/.test(credits)) fail("CREDITS.md should note R and F are Alba");

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
console.log("v62 letters file, hash and reference checks passed (26 clips; R/F/J/K match picked takes)");
