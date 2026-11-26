// v60 grammar and Letters-default check.
// Renders every templated spoken line and on-screen letter glyph from window.TheoCarMatch
// and fails on doubled articles, doubled words, and a wrong a/an.
//
// Run from the repo root (Playwright's own browser is not required; system Chrome is):
//   npm install --prefix /tmp/v60-test playwright-core
//   node tests/v60-grammar.mjs
import { createRequire } from "module";
import http from "http";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
function loadPlaywright() {
  const places = [
    path.join(root, "node_modules", "playwright-core", "package.json"),
    "/tmp/v60-test/node_modules/playwright-core/package.json"
  ];
  for (const pkg of places) {
    if (!fs.existsSync(pkg)) continue;
    return createRequire(pkg)("playwright-core");
  }
  throw new Error("playwright-core is not installed. See the comment at the top of this file.");
}
const { chromium } = loadPlaywright();

const failures = [];
function fail(msg) { failures.push(msg); }

// /juː/ and /wʌn/ take "a" even though the spelling starts with a vowel letter.
// umbrella, ugly, orange take "an". hour takes "an" (silent h).
const A_SOUND = /^(ute|unique|university|uniform|union|unit|united|use|user|useful|usual|european|euro|eucalyptus|unicorn|universe|ukulele|one|once|ufo)$/i;
const AN_SOUND = /^(hour|honest|honour|honor|heir|heiress)$/i;

function expectedArticle(word) {
  const w = String(word || "").toLowerCase().replace(/[^a-z]/g, "");
  if (!w) return null;
  if (AN_SOUND.test(w)) return "an";
  if (A_SOUND.test(w)) return "a";
  return /^[aeiou]/.test(w) ? "an" : "a";
}

function grammarProblems(line) {
  const text = String(line || "");
  const problems = [];
  if (/\ban\s+a\b/i.test(text)) problems.push("an a");
  if (/\ba\s+a\b/i.test(text)) problems.push("a a");
  if (/\bthe\s+the\b/i.test(text)) problems.push("the the");
  if (/\ban\s+an\b/i.test(text)) problems.push("an an");
  if (/\ba\s+an\b/i.test(text)) problems.push("a an");
  const doubled = text.match(/\b([A-Za-z]+)\s+\1\b/gi) || [];
  doubled.forEach(function (pair) {
    const word = pair.split(/\s+/)[0];
    if (word.toLowerCase() === "beep") return;
    problems.push("doubled " + pair);
  });
  const articles = text.matchAll(/\b(a|an)\s+([A-Za-z]+)/gi);
  for (const m of articles) {
    const got = m[1].toLowerCase();
    const want = expectedArticle(m[2]);
    if (want && got !== want) problems.push(got + " " + m[2] + " (want " + want + ")");
  }
  return problems;
}

function expectProblems(line, needle) {
  const got = grammarProblems(line);
  if (!got.length || !got.join(" ").toLowerCase().includes(needle)) {
    fail("checker should flag " + JSON.stringify(line) + " for " + needle + ", got " + JSON.stringify(got));
  }
}
function expectClean(line) {
  const got = grammarProblems(line);
  if (got.length) fail("checker flagged a good line " + JSON.stringify(line) + ": " + got.join("; "));
}

expectProblems("an a", "an a");
expectProblems("Say a a car", "a a");
expectProblems("the the car", "the the");
expectProblems("built a orange car", "a orange");
expectProblems("built an yellow car", "an yellow");
expectProblems("an ute", "an ute");
expectProblems("a umbrella", "a umbrella");
expectProblems("an unique car", "an unique");
expectProblems("a hour", "a hour");
expectProblems("car car", "doubled");
expectClean("an orange car");
expectClean("a yellow ute");
expectClean("a red ute");
expectClean("a ute");
expectClean("an umbrella");
expectClean("a unique uniform");
expectClean("an hour");
expectClean("a one");
expectClean("Beep beep!");
expectClean("Where's Rosie Racer?");
expectClean("Find Rosie, then Tugger. Pick both");
expectClean("Where does the square go?");
expectClean("Pick a colour!");
expectClean("Add the wheels!");
expectClean("Ay");
expectClean("A");
expectClean("Aa");

function serve(dir) {
  const types = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".mp3": "audio/mpeg", ".png": "image/png", ".svg": "image/svg+xml", ".css": "text/css" };
  return http.createServer(function (req, res) {
    const url = new URL(req.url, "http://127.0.0.1");
    let rel = decodeURIComponent(url.pathname);
    if (rel === "/") rel = "/index.html";
    const file = path.join(dir, rel);
    if (!file.startsWith(dir)) { res.writeHead(403); res.end(); return; }
    fs.readFile(file, function (err, buf) {
      if (err) { res.writeHead(404); res.end("missing"); return; }
      res.writeHead(200, { "Content-Type": types[path.extname(file)] || "application/octet-stream", "Cache-Control": "no-store" });
      res.end(buf);
    });
  });
}

async function openWith(browser, base, saved) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", function (err) { errors.push(String(err)); });
  await page.addInitScript(function (raw) {
    // Clear a missing save once. A reload in the same tab keeps what the game wrote.
    try {
      if (!sessionStorage.getItem("v60-booted")) {
        localStorage.removeItem("theo-car-match-letters");
        sessionStorage.setItem("v60-booted", "1");
      }
      if (raw) localStorage.setItem("theo-car-match-letters", raw);
    } catch (e) {}
    window.__theoSrcs = [];
    var desc = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, "src");
    Object.defineProperty(HTMLMediaElement.prototype, "src", {
      configurable: true,
      get: function () { return desc.get.call(this); },
      set: function (v) { window.__theoSrcs.push(String(v)); desc.set.call(this, v); }
    });
  }, saved || "");
  await page.goto(base, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForFunction(function () { return window.TheoCarMatch && window.TheoCarMatch.letterSettings && window.TheoCarMatch.grammarLines; }, null, { timeout: 15000 });
  return { ctx: ctx, page: page, errors: errors };
}

async function main() {
  const server = serve(root);
  await new Promise(function (resolve) { server.listen(0, "127.0.0.1", resolve); });
  const port = server.address().port;
  const base = "http://127.0.0.1:" + port + "/index.html";
  const browser = await chromium.launch({
    executablePath: process.env.CHROME || "/usr/bin/google-chrome",
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--autoplay-policy=no-user-gesture-required"]
  });
  try {
    const fresh = await openWith(browser, base, "");
    if (fresh.errors.length) fail("page errors: " + fresh.errors.join(" | "));
    const boot = await fresh.page.locator("#boot-error").count();
    if (boot) {
      const t = await fresh.page.locator("#boot-error").textContent();
      if (t) fail("boot error: " + t);
    }

    const settings = await fresh.page.evaluate(function () { return window.TheoCarMatch.letterSettings(); });
    if (settings.case !== "upper" || settings.v !== 60) fail("fresh letters settings " + JSON.stringify(settings));
    if (settings.level !== "easy") fail("fresh letters level " + settings.level);
    const voice = await fresh.page.evaluate(function () { return window.TheoCarMatch.voiceStyle("letters"); });
    if (voice !== "alba") fail("letters voice " + voice);

    // v61: a saved v60 Emma letters voice must move to alba and play sounds/letters/.
    const migCtx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const migPage = await migCtx.newPage();
    await migPage.addInitScript(function () {
      localStorage.setItem("theo-car-match-voice-styles", JSON.stringify({
        name: "classic", match: "alba", build: "alba", shadow: "alba", shapes: "alba", numbers: "alba",
        letters: "emma", lettersV: 54
      }));
      window.__theoSrcs = [];
      var desc = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, "src");
      Object.defineProperty(HTMLMediaElement.prototype, "src", {
        configurable: true,
        get: function () { return desc.get.call(this); },
        set: function (v) { window.__theoSrcs.push(String(v)); desc.set.call(this, v); }
      });
    });
    await migPage.goto(base, { waitUntil: "domcontentloaded", timeout: 30000 });
    await migPage.waitForFunction(function () { return window.TheoCarMatch && window.TheoCarMatch.voiceStyle; }, null, { timeout: 15000 });
    const migratedVoice = await migPage.evaluate(function () {
      return {
        voice: window.TheoCarMatch.voiceStyle("letters"),
        raw: JSON.parse(localStorage.getItem("theo-car-match-voice-styles") || "{}")
      };
    });
    if (migratedVoice.voice !== "alba") fail("v60 emma letters should migrate to alba, got " + JSON.stringify(migratedVoice));
    await migPage.evaluate(function () { window.TheoCarMatch.startLetters(); });
    await migPage.waitForTimeout(900);
    const migSrc = await migPage.evaluate(function () { return (window.__theoSrcs || []).join(" "); });
    if (migSrc.indexOf("sounds/letters/let-") < 0) fail("migrated letters audio src " + migSrc);
    await migCtx.close();

    const numbers = await fresh.page.evaluate(function () { return window.TheoCarMatch.numberSettings(); });
    if (numbers.level !== "easy" || numbers.upto !== 20 || numbers.v !== 49) fail("numbers settings changed " + JSON.stringify(numbers));
    const version = await fresh.page.evaluate(function () { return window.TheoCarMatch.version; });
    if (version !== "61") fail("app version " + version);

    const opts = await fresh.page.evaluate(function () {
      return Array.prototype.map.call(document.querySelectorAll("#lt-set-case option"), function (o) { return o.value; });
    });
    if (opts[0] !== "upper" || opts.indexOf("both") < 0 || opts.indexOf("lower") < 0 || opts.length !== 3) {
      fail("letter case options " + JSON.stringify(opts));
    }

    const corpus = await fresh.page.evaluate(function () { return window.TheoCarMatch.grammarLines(); });
    const after = await fresh.page.evaluate(function () { return window.TheoCarMatch.letterSettings(); });
    if (after.case !== "upper") fail("grammarLines changed the saved case to " + after.case);
    if (!corpus || !corpus.lines || corpus.lines.length < 200) fail("grammar corpus too small: " + (corpus && corpus.lines && corpus.lines.length));

    const seen = {};
    corpus.lines.forEach(function (line) {
      const problems = grammarProblems(line);
      if (problems.length) fail(JSON.stringify(line) + " -> " + problems.join(", "));
      seen[line] = true;
    });
    Object.keys(corpus.say).forEach(function (L) {
      const say = corpus.say[L];
      if (/^(an |a |the )/i.test(say)) fail("letter say starts with an article: " + L + " " + say);
    });
    if (Object.keys(corpus.say).length !== 26) fail("letter say count " + Object.keys(corpus.say).length);
    ["A", "B", "C", "Q", "Z"].forEach(function (L) {
      const i = L.charCodeAt(0) - 65;
      if (corpus.disp.upper[i] !== L) fail("upper disp " + L + " is " + corpus.disp.upper[i]);
      if (corpus.disp.lower[i] !== L.toLowerCase()) fail("lower disp " + L + " is " + corpus.disp.lower[i]);
      if (corpus.disp.both[i] !== L + L.toLowerCase()) fail("both disp " + L + " is " + corpus.disp.both[i]);
    });
    if (corpus.disp.upper.length !== 26 || corpus.disp.lower.length !== 26 || corpus.disp.both.length !== 26) fail("disp length");
    const wantNumbers = ["One!", "Two!", "Three!", "Four!", "Five!", "Six!", "Seven!", "Eight!", "Nine!", "Ten!", "Eleven!", "Twelve!", "Thirteen!", "Fourteen!", "Fifteen!", "Sixteen!", "Seventeen!", "Eighteen!", "Nineteen!", "Twenty!"];
    if (corpus.numbers.join("|") !== wantNumbers.join("|")) fail("numbers lines " + corpus.numbers.join(", "));
    corpus.numbers.forEach(function (n) { if (!seen[n]) fail("missing number line " + n); });
    if (corpus.shapes.length !== 15) fail("shape questions " + corpus.shapes.length);
    corpus.shapes.forEach(function (s) {
      if (!/^Where does the [a-z]+ go\?$/.test(s)) fail("shape line " + s);
      if (!seen[s]) fail("shape line not in corpus " + s);
    });
    ["Rosie", "Rosie Racer", "Officer Dot", "Tugger"].forEach(function (nm) {
      const where = "Where's " + nm + "?";
      if (!seen[where]) fail("missing " + where);
    });
    if (!seen["Find Rosie, then Tugger. Pick both"]) fail("missing two-in-a-row line");
    if (!seen["an orange car"] && !corpus.lines.some(function (l) { return l.indexOf("an orange ") === 0; })) fail("missing an orange build line");
    if (!corpus.lines.some(function (l) { return / built an orange /.test(l) && /!$/.test(l); })) fail("missing built-an-orange sentence");
    if (!corpus.lines.some(function (l) { return /a yellow ute/.test(l); })) fail("missing a yellow ute");
    const colours = ["red", "blue", "yellow", "green", "orange", "purple"];
    const vehicles = ["car", "ute", "truck", "bus", "fire truck", "rubbish truck", "excavator", "dump truck", "steamroller", "backhoe", "forklift", "front loader"];
    colours.forEach(function (c) {
      vehicles.forEach(function (v) {
        const art = expectedArticle(c);
        const mid = art + " " + c + " " + v;
        if (!seen[mid]) fail("missing build line " + mid);
        if (!corpus.lines.some(function (l) { return l.indexOf("built " + mid + "!") >= 0; })) fail("missing sentence for " + mid);
      });
    });

    async function migrated(raw) {
      const session = await openWith(browser, base, raw);
      const got = await session.page.evaluate(function () { return window.TheoCarMatch.letterSettings(); });
      if (session.errors.length) fail("migrate page error " + raw + " " + session.errors.join(" | "));
      await session.ctx.close();
      return got;
    }
    const bothOld = await migrated(JSON.stringify({ v: 54, case: "both", level: "easy" }));
    if (bothOld.case !== "upper" || bothOld.v !== 60) fail("v54 both should become upper, got " + JSON.stringify(bothOld));
    const lowerOld = await migrated(JSON.stringify({ v: 54, case: "lower", level: "medium" }));
    if (lowerOld.case !== "lower" || lowerOld.level !== "medium" || lowerOld.v !== 60) fail("v54 lower should stay lower, got " + JSON.stringify(lowerOld));
    const upperOld = await migrated(JSON.stringify({ v: 54, case: "upper", level: "hard" }));
    if (upperOld.case !== "upper" || upperOld.level !== "hard") fail("saved upper should stay upper, got " + JSON.stringify(upperOld));
    const bothNew = await migrated(JSON.stringify({ v: 60, case: "both", level: "easy" }));
    if (bothNew.case !== "both" || bothNew.v !== 60) fail("v60 both should stay both, got " + JSON.stringify(bothNew));
    const missing = await migrated("");
    if (missing.case !== "upper" || missing.v !== 60 || missing.level !== "easy") fail("missing save " + JSON.stringify(missing));
    const invalid = await migrated(JSON.stringify({ v: 60, case: "sideways" }));
    if (invalid.case !== "upper") fail("invalid case " + JSON.stringify(invalid));

    // Choosing "both" again writes v: 60 and is left alone.
    await fresh.page.evaluate(function () {
      var sel = document.getElementById("lt-set-case");
      sel.value = "both";
      sel.dispatchEvent(new Event("change"));
    });
    const picked = await fresh.page.evaluate(function () {
      return { mem: window.TheoCarMatch.letterSettings(), raw: JSON.parse(localStorage.getItem("theo-car-match-letters") || "{}") };
    });
    if (picked.mem.case !== "both" || picked.mem.v !== 60 || picked.raw.case !== "both" || picked.raw.v !== 60) {
      fail("picking both did not save v60 both: " + JSON.stringify(picked));
    }
    await fresh.page.reload({ waitUntil: "domcontentloaded" });
    await fresh.page.waitForFunction(function () { return window.TheoCarMatch && window.TheoCarMatch.letterSettings; });
    const kept = await fresh.page.evaluate(function () { return window.TheoCarMatch.letterSettings(); });
    if (kept.case !== "both") fail("reloaded both became " + kept.case);

    await fresh.page.evaluate(function () { window.TheoCarMatch.letterSettings({ case: "upper", level: "easy" }); });
    await fresh.page.setViewportSize({ width: 1280, height: 800 });
    await fresh.page.evaluate(function () { window.TheoCarMatch.startLetters(); });
    await fresh.page.waitForTimeout(900);
    const easy = await fresh.page.evaluate(function () {
      var st = window.TheoCarMatch.numbersState();
      var src = "";
      document.querySelectorAll("audio").forEach(function (a) { if (a.src && a.src.indexOf("let-") >= 0) src = a.src; });
      return {
        st: st,
        say: window.TheoCarMatch.buildSayLog(),
        pair: document.getElementById("shadow-screen").classList.contains("is-pair"),
        src: src,
        srcs: (window.__theoSrcs || []).slice(),
        tiles: Array.prototype.map.call(document.querySelectorAll("#sh-tray .nm-tile"), function (e) { return e.textContent; })
      };
    });
    if (easy.st.caseMode !== "upper") fail("caseMode " + easy.st.caseMode);
    if (easy.st.level !== "easy") fail("letters level while playing " + easy.st.level);
    if (!/^l:[A-Z]$/.test(easy.st.target)) fail("letters target " + easy.st.target);
    if (easy.st.boxText.join("") !== easy.st.target.slice(2)) fail("box " + JSON.stringify(easy.st.boxText) + " target " + easy.st.target);
    if (easy.st.cornerText !== easy.st.boxText.join("")) fail("corner " + easy.st.cornerText);
    easy.tiles.forEach(function (t) { if (!/^[A-Z]$/.test(t)) fail("capital tile " + JSON.stringify(t)); });
    if (easy.tiles.length !== 4) fail("easy tile count " + easy.tiles.length);
    if (easy.pair) fail("upper board has the pair class");
    const says = (easy.st.sayLog || []).filter(function (s) { return String(s).indexOf("say:") === 0; });
    if (says.length !== 1 || !/^say:let-[a-z]$/.test(says[0])) fail("easy announcement " + JSON.stringify(easy.st.sayLog));
    if (easy.say.length !== 1 || !/^voice\/let-[a-z]$/.test(easy.say[0])) fail("easy say log " + JSON.stringify(easy.say));
    const letterSrc = (easy.srcs || []).concat([easy.src]).join(" ");
    if (letterSrc.indexOf("sounds/letters/let-") < 0) fail("letters audio src " + letterSrc);
    if (easy.st.cornerShown !== true) fail("easy corner hidden");

    await fresh.page.setViewportSize({ width: 390, height: 844 });
    await fresh.page.evaluate(function () { window.TheoCarMatch.startLetters(); });
    await fresh.page.waitForTimeout(200);
    const phone = await fresh.page.evaluate(function () {
      return Array.prototype.map.call(document.querySelectorAll("#sh-tray .nm-tile, #nm-shadow .nm-gl"), function (e) { return e.textContent; });
    });
    phone.forEach(function (t) { if (!/^[A-Z]$/.test(t)) fail("phone glyph " + JSON.stringify(t)); });

    await fresh.page.setViewportSize({ width: 1280, height: 800 });
    await fresh.page.evaluate(function () { window.TheoCarMatch.letterSettings({ case: "both" }); window.TheoCarMatch.startLetters(); });
    await fresh.page.waitForTimeout(200);
    const pair = await fresh.page.evaluate(function () {
      var st = window.TheoCarMatch.numbersState();
      return { caseMode: st.caseMode, box: st.boxText, tiles: Array.prototype.map.call(document.querySelectorAll("#sh-tray .nm-tile"), function (e) { return e.textContent; }), pair: document.getElementById("shadow-screen").classList.contains("is-pair") };
    });
    if (pair.caseMode !== "both" || !pair.pair) fail("both mode " + JSON.stringify(pair));
    if (!/^[A-Z][a-z]$/.test(pair.box.join(""))) fail("both box " + JSON.stringify(pair.box));
    pair.tiles.forEach(function (t) { if (!/^[A-Z][a-z]$/.test(t)) fail("both tile " + JSON.stringify(t)); });

    await fresh.page.evaluate(function () { window.TheoCarMatch.letterSettings({ case: "lower" }); window.TheoCarMatch.startLetters(); });
    await fresh.page.waitForTimeout(200);
    const lower = await fresh.page.evaluate(function () {
      return Array.prototype.map.call(document.querySelectorAll("#sh-tray .nm-tile, #nm-shadow .nm-gl"), function (e) { return e.textContent; });
    });
    lower.forEach(function (t) { if (!/^[a-z]$/.test(t)) fail("lower glyph " + JSON.stringify(t)); });

    await fresh.page.evaluate(function () { window.TheoCarMatch.goHome(); window.TheoCarMatch.startNumbers(); });
    await fresh.page.waitForTimeout(900);
    const nums = await fresh.page.evaluate(function () {
      var st = window.TheoCarMatch.numbersState();
      return { st: st, say: window.TheoCarMatch.buildSayLog(), voice: window.TheoCarMatch.voiceStyle("numbers") };
    });
    if (nums.voice !== "alba") fail("numbers voice " + nums.voice);
    if (nums.st.mode !== "numbers" || nums.st.level !== "easy" || nums.st.upto !== 20) fail("numbers state " + JSON.stringify(nums.st));
    if (!/^n:\d+$/.test(nums.st.target)) fail("numbers target " + nums.st.target);
    nums.st.boxText.forEach(function (t) { if (!/^\d$/.test(t)) fail("number box " + t); });
    const numSays = (nums.st.sayLog || []).filter(function (s) { return String(s).indexOf("say:") === 0; });
    const lastSay = numSays[numSays.length - 1] || "";
    if (!/^say:num-\d+$/.test(lastSay)) fail("numbers announcement " + JSON.stringify(nums.st.sayLog));
    if (!nums.say.some(function (s) { return /^voice\/num-\d+$/.test(s); })) fail("numbers say log " + JSON.stringify(nums.say));

    const ver = await fresh.page.evaluate(function () {
      return fetch("./version.json", { cache: "no-store" }).then(function (r) { return r.json(); });
    });
    if (ver.version !== "61" || ver.cache !== "theo-car-match-v61" || ver.name !== "Car Games") fail("version.json " + JSON.stringify(ver));
    const sw = await fresh.page.evaluate(function () {
      return fetch("./sw.js", { cache: "no-store" }).then(function (r) { return r.text(); });
    });
    if (sw.indexOf('var CACHE = "theo-car-match-v61"') < 0) fail("sw.js cache is not theo-car-match-v61");
    if (sw.indexOf("theo-car-match-v60") >= 0) fail("sw.js still names the v60 cache");

    const shotDir = process.env.SHOT_DIR || "/tmp/v61-test-shots";
    try { fs.mkdirSync(shotDir, { recursive: true }); } catch (e) {}
    await fresh.page.setViewportSize({ width: 1280, height: 800 });
    await fresh.page.evaluate(function () { window.TheoCarMatch.letterSettings({ case: "upper", level: "easy" }); window.TheoCarMatch.goHome(); window.TheoCarMatch.openSettings(); });
    await fresh.page.click("#tab-letters");
    const shown = await fresh.page.evaluate(function () {
      var sel = document.getElementById("lt-set-case");
      var pane = document.getElementById("pane-letters");
      return { hidden: pane.hidden, value: sel.value, first: sel.options[0].text, voice: document.getElementById("voice-style-letters").value, level: document.getElementById("lt-set-level").value };
    });
    if (shown.hidden || shown.value !== "upper" || shown.first.indexOf("Capital letters only") !== 0) fail("letters settings pane " + JSON.stringify(shown));
    if (shown.voice !== "alba" || shown.level !== "easy") fail("letters voice or level in settings " + JSON.stringify(shown));
    await fresh.page.screenshot({ path: path.join(shotDir, "v60-letters-settings.png") });
    await fresh.page.evaluate(function () { window.TheoCarMatch.closeSettings(); window.TheoCarMatch.startLetters(); });
    await fresh.page.waitForTimeout(300);
    await fresh.page.screenshot({ path: path.join(shotDir, "v60-letters-capitals.png") });
    await fresh.page.setViewportSize({ width: 390, height: 844 });
    await fresh.page.evaluate(function () { window.TheoCarMatch.startLetters(); });
    await fresh.page.waitForTimeout(200);
    await fresh.page.screenshot({ path: path.join(shotDir, "v60-letters-capitals-phone.png") });
    await fresh.page.setViewportSize({ width: 1280, height: 800 });
    await fresh.page.evaluate(function () { window.TheoCarMatch.letterSettings({ case: "both" }); window.TheoCarMatch.startLetters(); });
    await fresh.page.waitForTimeout(250);
    await fresh.page.screenshot({ path: path.join(shotDir, "v60-letters-both.png") });

    await fresh.ctx.close();
  } finally {
    await browser.close();
    server.close();
  }
  if (failures.length) {
    console.error(failures.length + " failure(s):");
    failures.forEach(function (f) { console.error(" - " + f); });
    process.exit(1);
  }
  console.log("v60 grammar and v61 letters checks passed");
}

main().catch(function (err) {
  console.error(err);
  process.exit(1);
});
