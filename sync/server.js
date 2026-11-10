#!/usr/bin/env node
"use strict";

var http = require("http");
var https = require("https");
var fs = require("fs");
var path = require("path");
var crypto = require("crypto");
var zlib = require("zlib");
var os = require("os");
var querystring = require("querystring");
var certs = require("./certs");
var pinLib = require("./pin");

var ROOT = path.resolve(__dirname);
var DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(ROOT, "data"));
var GAME_DIR = path.resolve(process.env.GAME_DIR || path.join(ROOT, "game"));
var CARDS_DIR = path.join(DATA_DIR, "cards");
var KEY_FILE = path.join(DATA_DIR, "family-key.txt");
var PORT = parseInt(process.env.PORT || "8787", 10);
var HTTPS_PORT = parseInt(process.env.HTTPS_PORT || "8788", 10);
var HOST = process.env.HOST || "0.0.0.0";
var MAX_JSON = 512 * 1024;
var MAX_BLOB = 12 * 1024 * 1024;
var PAGES_ORIGIN = "https://knoddy86-lab.github.io";
var ID_RE = /^[a-zA-Z0-9_-]{1,80}$/;
var GAME_VERSION_FALLBACK = { version: "14", cache: "theo-car-match-v14", name: "Theo's Car Match" };

function readGameVersion() {
  try {
    var raw = JSON.parse(fs.readFileSync(path.join(GAME_DIR, "version.json"), "utf8"));
    if (raw && raw.version) return { version: String(raw.version), cache: raw.cache || ("theo-car-match-v" + raw.version), name: raw.name || "Theo's Car Match" };
  } catch (e) {}
  return GAME_VERSION_FALLBACK;
}

var MIMES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".m4a": "audio/mp4",
  ".mp4": "audio/mp4",
  ".webm": "audio/webm",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".json": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".webmanifest": "application/manifest+json",
  ".crt": "application/x-x509-ca-cert",
  ".mobileconfig": "application/x-apple-aspen-config",
  ".webapp": "application/x-web-app-manifest+json"
};

function ensureDirs() {
  fs.mkdirSync(CARDS_DIR, { recursive: true });
  fs.mkdirSync(path.join(ROOT, "logs"), { recursive: true });
}

function generateKey() {
  return crypto.randomBytes(32).toString("hex");
}

function loadOrCreateKey() {
  if (process.env.FAMILY_KEY && process.env.FAMILY_KEY.trim()) {
    return process.env.FAMILY_KEY.trim();
  }
  if (fs.existsSync(KEY_FILE)) {
    var existing = fs.readFileSync(KEY_FILE, "utf8").trim();
    if (existing) return existing;
  }
  var key = generateKey();
  fs.writeFileSync(KEY_FILE, key + "\n", { encoding: "utf8", mode: 0o600 });
  return key;
}

ensureDirs();
var FAMILY_KEY = loadOrCreateKey();
var KEY_BUF = Buffer.from(FAMILY_KEY);
var pinStore = new pinLib.PinStore(DATA_DIR);
var tlsBundle = null;
try {
  tlsBundle = certs.ensureCerts(DATA_DIR);
} catch (e) {
  console.error("Could not create HTTPS certificates:", e && e.message ? e.message : e);
}

function safeEqual(a, b) {
  var ba = Buffer.from(String(a || ""), "utf8");
  var bb = Buffer.from(String(b || ""), "utf8");
  if (ba.length !== bb.length) {
    crypto.timingSafeEqual(ba.length ? ba : Buffer.from("x"), ba.length ? ba : Buffer.from("x"));
    return false;
  }
  return crypto.timingSafeEqual(ba, bb);
}

function lanIPv4() {
  var out = [];
  var ifs = os.networkInterfaces();
  Object.keys(ifs).forEach(function (name) {
    (ifs[name] || []).forEach(function (addr) {
      if (addr.family === "IPv4" && !addr.internal) out.push(addr.address);
    });
  });
  return out;
}

function allowedOrigin(origin, req) {
  if (!origin) return null;
  if (origin === PAGES_ORIGIN) return origin;
  try {
    var u = new URL(origin);
    var host = (req && req.headers && req.headers.host) || "";
    if (host && u.host === host) return origin;
    var ips = lanIPv4();
    if (ips.indexOf(u.hostname) !== -1) return origin;
    if (process.env.ALLOW_LOCAL === "1" && (u.hostname === "localhost" || u.hostname === "127.0.0.1" || u.hostname === "[::1]")) return origin;
  } catch (e) {}
  return null;
}

function addVary(res, token) {
  var cur = res.getHeader("Vary");
  if (!cur) {
    res.setHeader("Vary", token);
    return;
  }
  var parts = String(cur).split(/,\s*/);
  if (parts.indexOf(token) === -1) res.setHeader("Vary", String(cur) + ", " + token);
}

function setCors(req, res) {
  var origin = allowedOrigin(req.headers.origin, req);
  if (origin) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    addVary(res, "Origin");
    res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type, X-Family-Key, X-Parent-Pin, X-Updated-At, If-None-Match");
    res.setHeader("Access-Control-Allow-Methods", "GET, PUT, POST, DELETE, OPTIONS");
    res.setHeader("Access-Control-Expose-Headers", "ETag");
    res.setHeader("Access-Control-Max-Age", "86400");
  }
}

function wantsGzip(req) {
  var ae = (req && req.headers && req.headers["accept-encoding"]) || "";
  return /\bgzip\b/i.test(ae);
}

function shouldGzipType(type) {
  if (!type) return false;
  var t = String(type).split(";")[0].trim().toLowerCase();
  return t === "application/json" || t.indexOf("text/") === 0 || t === "application/javascript" || t === "text/javascript" || t === "application/xml" || t === "image/svg+xml";
}

function send(res, code, type, body, extra) {
  res.statusCode = code;
  if (type) res.setHeader("Content-Type", type);
  if (!res.getHeader("Cache-Control")) res.setHeader("Cache-Control", "no-store");
  if (extra) Object.keys(extra).forEach(function (k) { res.setHeader(k, extra[k]); });
  var buf = Buffer.isBuffer(body) ? body : Buffer.from(body == null ? "" : String(body));
  var req = res.req;
  if (buf.length >= 256 && shouldGzipType(type) && wantsGzip(req) && !res.getHeader("Content-Encoding")) {
    buf = zlib.gzipSync(buf);
    res.setHeader("Content-Encoding", "gzip");
    addVary(res, "Accept-Encoding");
  }
  res.setHeader("Content-Length", buf.length);
  res.end(buf);
}

function sendJson(res, code, obj, extra) {
  send(res, code, "application/json; charset=utf-8", JSON.stringify(obj), extra);
}

function readRequest(req, max) {
  return new Promise(function (resolve, reject) {
    var chunks = [];
    var size = 0;
    req.on("data", function (c) {
      size += c.length;
      if (size > max) {
        reject(Object.assign(new Error("too large"), { code: 413 }));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", function () { resolve(Buffer.concat(chunks)); });
    req.on("error", reject);
  });
}

function authorized(req) {
  var header = req.headers.authorization || "";
  var bearer = header.replace(/^Bearer\s+/i, "").trim();
  var alt = (req.headers["x-family-key"] || "").trim();
  var got = bearer || alt;
  return !!(got && safeEqual(got, FAMILY_KEY));
}

function cardPath(id, kind) {
  if (!ID_RE.test(id)) return null;
  var names = {
    meta: ".json",
    image: ".image",
    audio: ".audio",
    original: ".original",
    "image-type": ".image.type",
    "audio-type": ".audio.type",
    "original-type": ".original.type"
  };
  if (!names[kind]) return null;
  return path.join(CARDS_DIR, id + names[kind]);
}

function readMeta(id) {
  var p = cardPath(id, "meta");
  if (!p || !fs.existsSync(p)) return null;
  try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch (e) { return null; }
}

function writeMeta(id, meta) {
  var p = cardPath(id, "meta");
  fs.writeFileSync(p, JSON.stringify(meta, null, 2));
  invalidateManifest();
}

function blobInfo(id, kind) {
  var p = cardPath(id, kind);
  if (!p || !fs.existsSync(p)) return { has: false, size: 0, type: "" };
  var tp = cardPath(id, kind + "-type");
  var type = "";
  try { if (tp && fs.existsSync(tp)) type = fs.readFileSync(tp, "utf8").trim(); } catch (e) {}
  return { has: true, size: fs.statSync(p).size, type: type };
}


function settingsPath() {
  return path.join(DATA_DIR, "settings.json");
}

function readSettings() {
  try {
    var raw = JSON.parse(fs.readFileSync(settingsPath(), "utf8"));
    return sanitizeSettings(raw);
  } catch (e) {
    return null;
  }
}

function clampInt(n, lo, hi, fallback) {
  n = parseInt(n, 10);
  if (!isFinite(n)) n = fallback;
  return Math.max(lo, Math.min(hi, n));
}

function sanitizeSettings(raw) {
  raw = raw && typeof raw === "object" ? raw : {};
  var preset = raw.preset;
  if (["age2", "age3", "age45", "age6", "custom"].indexOf(preset) < 0) preset = "custom";
  var grow = raw.grow !== false;
  var startPairs = clampInt(raw.startPairs, 2, 10, 2);
  var maxPairs = clampInt(raw.maxPairs, 2, 10, Math.max(startPairs, 4));
  if (!grow) maxPairs = startPairs;
  if (maxPairs < startPairs) maxPairs = startPairs;
  var cardSize = raw.cardSize;
  if (cardSize !== "large" && cardSize !== "xl") cardSize = "auto";
  var peek = clampInt(raw.peek, 0, 3, 0);
  var flipBack = raw.flipBack;
  if (flipBack !== "slow" && flipBack !== "fast") flipBack = "normal";
  var shuffle = raw.shuffle === "keep" ? "keep" : "reshuffle";
  var hint = (raw.hint === 20 || raw.hint === "20") ? 20 : ((raw.hint === 10 || raw.hint === "10") ? 10 : 0);
  return {
    preset: preset,
    grow: grow,
    startPairs: startPairs,
    maxPairs: maxPairs,
    cardSize: cardSize,
    peek: peek,
    flipBack: flipBack,
    shuffle: shuffle,
    hint: hint,
    speakFlip: raw.speakFlip !== false,
    revs: raw.revs !== false,
    updatedAt: Number(raw.updatedAt) || Date.now()
  };
}

function writeSettings(incoming) {
  var current = readSettings() || {};
  var next = sanitizeSettings(Object.assign({}, current, incoming || {}));
  next.updatedAt = Number(incoming && incoming.updatedAt) || Date.now();
  fs.writeFileSync(settingsPath(), JSON.stringify(next, null, 2));
  invalidateManifest();
  return next;
}

function listIds() {
  var seen = {};
  fs.readdirSync(CARDS_DIR).forEach(function (name) {
    var m = name.match(/^([a-zA-Z0-9_-]{1,80})\.(json|image|audio|original)$/);
    if (m) seen[m[1]] = true;
  });
  return Object.keys(seen);
}

function publicCard(id) {
  var meta = readMeta(id) || { id: id, updatedAt: 0 };
  var image = blobInfo(id, "image");
  var audio = blobInfo(id, "audio");
  var original = blobInfo(id, "original");
  return {
    id: id,
    updatedAt: meta.updatedAt || 0,
    name: meta.name || "",
    sayLike: meta.sayLike || "",
    nickname: meta.nickname || "",
    line: meta.line || "",
    custom: !!meta.custom,
    deleted: !!meta.deleted,
    removeWhite: meta.removeWhite !== false,
    color: meta.color || "",
    dark: meta.dark || "",
    light: meta.light || "",
    window: meta.window || "",
    hasImage: image.has && !meta.deleted,
    imageUpdatedAt: meta.imageUpdatedAt || 0,
    imageType: image.type,
    hasOriginal: original.has && !meta.deleted,
    originalUpdatedAt: meta.originalUpdatedAt || 0,
    originalType: original.type,
    hasAudio: audio.has && !meta.deleted,
    audioUpdatedAt: meta.audioUpdatedAt || 0,
    audioType: audio.type
  };
}

function mergeMeta(id, incoming) {
  var cur = readMeta(id);
  var nextUpdated = Number(incoming.updatedAt) || 0;
  if (cur && (Number(cur.updatedAt) || 0) > nextUpdated) {
    return { kept: "server", card: publicCard(id) };
  }
  var next = {
    id: id,
    updatedAt: nextUpdated || Date.now(),
    name: incoming.name ? String(incoming.name).slice(0, 80) : "",
    sayLike: incoming.sayLike ? String(incoming.sayLike).slice(0, 80) : "",
    nickname: incoming.nickname ? String(incoming.nickname).slice(0, 80) : "",
    line: incoming.line ? String(incoming.line).slice(0, 120) : "",
    custom: !!incoming.custom,
    deleted: !!incoming.deleted,
    color: incoming.color ? String(incoming.color).slice(0, 20) : "",
    dark: incoming.dark ? String(incoming.dark).slice(0, 20) : "",
    light: incoming.light ? String(incoming.light).slice(0, 20) : "",
    window: incoming.window ? String(incoming.window).slice(0, 20) : "",
    removeWhite: incoming.removeWhite !== false,
    imageUpdatedAt: cur && cur.imageUpdatedAt ? cur.imageUpdatedAt : 0,
    originalUpdatedAt: cur && cur.originalUpdatedAt ? cur.originalUpdatedAt : 0,
    audioUpdatedAt: cur && cur.audioUpdatedAt ? cur.audioUpdatedAt : 0
  };
  if (incoming.imageUpdatedAt != null) next.imageUpdatedAt = Number(incoming.imageUpdatedAt) || 0;
  if (incoming.originalUpdatedAt != null) next.originalUpdatedAt = Number(incoming.originalUpdatedAt) || 0;
  if (incoming.audioUpdatedAt != null) next.audioUpdatedAt = Number(incoming.audioUpdatedAt) || 0;
  if (incoming.clearImage) {
    removeBlob(id, "image");
    next.imageUpdatedAt = next.updatedAt;
  }
  if (incoming.clearOriginal) {
    removeBlob(id, "original");
    next.originalUpdatedAt = next.updatedAt;
  }
  if (incoming.clearAudio) {
    removeBlob(id, "audio");
    next.audioUpdatedAt = next.updatedAt;
  }
  if (next.deleted) {
    removeBlob(id, "image");
    removeBlob(id, "original");
    removeBlob(id, "audio");
  }
  writeMeta(id, next);
  return { kept: "client", card: publicCard(id) };
}

function removeBlob(id, kind) {
  ["", "-type"].forEach(function (suffix) {
    var p = cardPath(id, suffix ? kind + suffix.replace("-", "") : kind);
    // kind-type handled below
  });
  var file = cardPath(id, kind);
  var typeFile = cardPath(id, kind + "-type");
  try { if (file && fs.existsSync(file)) fs.unlinkSync(file); } catch (e) {}
  try { if (typeFile && fs.existsSync(typeFile)) fs.unlinkSync(typeFile); } catch (e) {}
  invalidateManifest();
}

function saveBlob(id, kind, buf, type, updatedAt) {
  var file = cardPath(id, kind);
  var typeFile = cardPath(id, kind + "-type");
  fs.writeFileSync(file, buf);
  fs.writeFileSync(typeFile, (type || "application/octet-stream").split(";")[0].slice(0, 80));
  invalidateManifest();
  var meta = readMeta(id) || { id: id, updatedAt: 0 };
  var ts = Number(updatedAt) || Date.now();
  if (kind === "image") meta.imageUpdatedAt = ts;
  if (kind === "original") meta.originalUpdatedAt = ts;
  if (kind === "audio") meta.audioUpdatedAt = ts;
  if (ts > (meta.updatedAt || 0)) meta.updatedAt = ts;
  writeMeta(id, meta);
}

function safeGamePath(urlPath) {
  var decoded;
  try { decoded = decodeURIComponent(urlPath.split("?")[0]); } catch (e) { return null; }
  if (decoded === "/") decoded = "/index.html";
  if (decoded.indexOf("\0") !== -1) return null;
  if (decoded.indexOf("..") !== -1) return null;
  var rel = decoded.replace(/^\/+/, "");
  var full = path.resolve(GAME_DIR, rel);
  if (full !== GAME_DIR && full.indexOf(GAME_DIR + path.sep) !== 0) return null;
  return full;
}

function serveGame(req, res, urlPath) {
  var file = safeGamePath(urlPath);
  if (!file) return send(res, 404, "text/plain; charset=utf-8", "Not found");
  fs.stat(file, function (err, st) {
    if (err || !st.isFile()) return send(res, 404, "text/plain; charset=utf-8", "Not found");
    var ext = path.extname(file).toLowerCase();
    var type = MIMES[ext] || "application/octet-stream";
    res.statusCode = 200;
    res.setHeader("Content-Type", type);
    res.setHeader("Content-Length", st.size);
    var noStore = (ext === ".html" || path.basename(file) === "sw.js" || path.basename(file) === "manifest.json" || path.basename(file) === "version.json");
    res.setHeader("Cache-Control", noStore ? "no-store" : "public, max-age=3600");
    fs.createReadStream(file).pipe(res);
  });
}

var manifestCache = null;

function invalidateManifest() {
  manifestCache = null;
}

function lightCard(id) {
  var meta = readMeta(id) || { id: id, updatedAt: 0 };
  return {
    id: id,
    updatedAt: meta.updatedAt || 0,
    imageUpdatedAt: meta.imageUpdatedAt || 0,
    originalUpdatedAt: meta.originalUpdatedAt || 0,
    audioUpdatedAt: meta.audioUpdatedAt || 0,
    deleted: !!meta.deleted,
    hasImage: !meta.deleted && fs.existsSync(cardPath(id, "image")),
    hasOriginal: !meta.deleted && fs.existsSync(cardPath(id, "original")),
    hasAudio: !meta.deleted && fs.existsSync(cardPath(id, "audio"))
  };
}

function manifestState() {
  if (manifestCache) return manifestCache;
  var cards = {};
  var maxAt = 0;
  var parts = [];
  listIds().sort().forEach(function (id) {
    var c = lightCard(id);
    cards[id] = c;
    if ((c.updatedAt || 0) > maxAt) maxAt = c.updatedAt || 0;
    parts.push(
      id,
      String(c.updatedAt || 0),
      String(c.imageUpdatedAt || 0),
      String(c.originalUpdatedAt || 0),
      String(c.audioUpdatedAt || 0),
      c.deleted ? "1" : "0",
      c.hasImage ? "1" : "0",
      c.hasOriginal ? "1" : "0",
      c.hasAudio ? "1" : "0"
    );
  });
  var etag = crypto.createHash("sha1").update(parts.join("|")).digest("hex").slice(0, 16);
  manifestCache = { etag: etag, updatedAt: maxAt, count: Object.keys(cards).length, cards: cards };
  return manifestCache;
}

function etagMatches(req, etag) {
  var inm = req.headers["if-none-match"];
  if (!inm || !etag) return false;
  var want = String(etag);
  return String(inm).split(",").some(function (part) {
    var t = part.trim().replace(/^W\//, "").replace(/^"|"$/g, "");
    return t === want || t === "*";
  });
}

function sendEtagJson(req, res, etag, obj) {
  var tag = '"' + etag + '"';
  res.setHeader("ETag", tag);
  if (etagMatches(req, etag)) {
    res.statusCode = 304;
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Content-Length", 0);
    return res.end();
  }
  sendJson(res, 200, obj);
}

function handleApi(req, res, url) {
  var parts = url.pathname.replace(/\/+$/, "").split("/").filter(Boolean);
  // parts[0] === "api"
  if (req.method === "GET" && parts.length === 2 && parts[1] === "health") {
    var gv = readGameVersion();
    return sendJson(res, 200, { ok: true, service: "theo-sync", version: 3, gameVersion: gv.version, cache: gv.cache, httpsPort: HTTPS_PORT });
  }
  if (req.method === "GET" && parts.length === 2 && parts[1] === "version") {
    var ver = readGameVersion();
    return sendJson(res, 200, { ok: true, version: ver.version, cache: ver.cache, name: ver.name });
  }
  if (!authorized(req)) return sendJson(res, 401, { ok: false, error: "bad key" });

  if (req.method === "GET" && parts.length === 2 && parts[1] === "pin") {
    return sendJson(res, 200, { ok: true, set: pinStore.hasPin() });
  }

  if (req.method === "GET" && parts.length === 2 && parts[1] === "manifest") {
    var man = manifestState();
    return sendEtagJson(req, res, man.etag, {
      ok: true,
      etag: man.etag,
      updatedAt: man.updatedAt,
      count: man.count,
      cards: man.cards
    });
  }

  if (req.method === "GET" && parts.length === 2 && parts[1] === "sync") {
    var man = manifestState();
    var cards = {};
    listIds().forEach(function (id) { cards[id] = publicCard(id); });
    return sendEtagJson(req, res, man.etag, { ok: true, etag: man.etag, cards: cards, settings: readSettings() });
  }

  if (parts.length === 2 && parts[1] === "settings") {
    if (req.method === "GET") {
      return sendJson(res, 200, { ok: true, settings: readSettings() });
    }
    if (req.method === "PUT") {
      var pinGate = requireParentPin(req, res);
      if (pinGate !== true) return pinGate;
      return readRequest(req, MAX_JSON).then(function (buf) {
        var incoming;
        try { incoming = JSON.parse(buf.toString("utf8") || "{}"); } catch (e) {
          return sendJson(res, 400, { ok: false, error: "bad json" });
        }
        var saved = writeSettings(incoming);
        sendJson(res, 200, { ok: true, settings: saved });
      }).catch(function (e) {
        sendJson(res, e.code === 413 ? 413 : 400, { ok: false, error: e.message });
      });
    }
  }

  if (parts.length >= 3 && parts[1] === "cards") {
    var id = parts[2];
    if (!ID_RE.test(id)) return sendJson(res, 400, { ok: false, error: "bad id" });
    var kind = parts[3]; // image | audio | undefined

    if (req.method === "GET" && !kind) return sendJson(res, 200, { ok: true, card: publicCard(id) });

    if (req.method !== "GET") {
      var pinGate = requireParentPin(req, res);
      if (pinGate !== true) return pinGate;
    }

    if (req.method === "PUT" && !kind) {
      return readRequest(req, MAX_JSON).then(function (buf) {
        var incoming;
        try { incoming = JSON.parse(buf.toString("utf8") || "{}"); } catch (e) {
          return sendJson(res, 400, { ok: false, error: "bad json" });
        }
        incoming.id = id;
        var result = mergeMeta(id, incoming);
        sendJson(res, 200, { ok: true, kept: result.kept, card: result.card });
      }).catch(function (e) {
        sendJson(res, e.code === 413 ? 413 : 400, { ok: false, error: e.message });
      });
    }

    if ((req.method === "GET" || req.method === "PUT" || req.method === "DELETE") && (kind === "image" || kind === "audio" || kind === "original")) {
      if (req.method === "GET") {
        var info = blobInfo(id, kind);
        if (!info.has) return send(res, 404, "text/plain; charset=utf-8", "No file");
        var file = cardPath(id, kind);
        var st = fs.statSync(file);
        res.statusCode = 200;
        res.setHeader("Content-Type", info.type || "application/octet-stream");
        res.setHeader("Content-Length", st.size);
        res.setHeader("Cache-Control", "no-store");
        fs.createReadStream(file).pipe(res);
        return;
      }
      if (req.method === "DELETE") {
        removeBlob(id, kind);
        var meta = readMeta(id) || { id: id, updatedAt: Date.now() };
        var ts = Date.now();
        if (kind === "image") meta.imageUpdatedAt = ts;
        if (kind === "original") meta.originalUpdatedAt = ts;
        if (kind === "audio") meta.audioUpdatedAt = ts;
        if (ts > (meta.updatedAt || 0)) meta.updatedAt = ts;
        writeMeta(id, meta);
        return sendJson(res, 200, { ok: true, card: publicCard(id) });
      }
      return readRequest(req, MAX_BLOB).then(function (buf) {
        if (!buf.length) return sendJson(res, 400, { ok: false, error: "empty file" });
        var type = (req.headers["content-type"] || "application/octet-stream").split(";")[0];
        var ts = parseInt(req.headers["x-updated-at"], 10) || Date.now();
        var cur = readMeta(id);
        var field = kind === "image" ? "imageUpdatedAt" : kind === "original" ? "originalUpdatedAt" : "audioUpdatedAt";
        if (cur && (Number(cur[field]) || 0) > ts) {
          return sendJson(res, 200, { ok: true, kept: "server", card: publicCard(id) });
        }
        saveBlob(id, kind, buf, type, ts);
        sendJson(res, 200, { ok: true, kept: "client", card: publicCard(id) });
      }).catch(function (e) {
        sendJson(res, e.code === 413 ? 413 : 400, { ok: false, error: e.message });
      });
    }

    if (req.method === "DELETE" && !kind) {
      var now = Date.now();
      mergeMeta(id, { updatedAt: now, deleted: true, custom: true });
      return sendJson(res, 200, { ok: true, card: publicCard(id) });
    }
  }

  sendJson(res, 404, { ok: false, error: "not found" });
}


function clientIp(req) {
  return String(req.socket && req.socket.remoteAddress || "").replace(/^::ffff:/, "");
}

function isLocalRequest(req) {
  var ip = clientIp(req);
  return ip === "127.0.0.1" || ip === "::1" || ip === "localhost";
}

function parentPinFrom(req) {
  return String(req.headers["x-parent-pin"] || "").trim();
}

function requireParentPin(req, res) {
  if (!pinStore.hasPin()) {
    sendJson(res, 403, { ok: false, error: "pin not set", message: "A parent PIN has not been set on the home computer yet. On the computer, open http://127.0.0.1:8787/admin or run set-pin.bat." });
    return false;
  }
  var ip = clientIp(req);
  if (pinStore.isLimited(ip)) {
    sendJson(res, 429, { ok: false, error: "rate limited", message: "Too many wrong PIN tries. Wait 15 minutes and try again." });
    return false;
  }
  var pin = parentPinFrom(req);
  if (!pin) {
    sendJson(res, 403, { ok: false, error: "pin required", message: "A parent PIN is required to save changes to the home computer." });
    return false;
  }
  if (!pinStore.verify(pin)) {
    var n = pinStore.recordFail(ip);
    sendJson(res, 403, { ok: false, error: "bad pin", message: "That PIN was not accepted.", remaining: Math.max(0, pinLib.MAX_FAILS - n) });
    return false;
  }
  pinStore.clearFails(ip);
  return true;
}

function profileUuid() {
  if (crypto.randomUUID) return crypto.randomUUID().toUpperCase();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (ch) {
    var r = crypto.randomBytes(1)[0] % 16;
    var v = ch === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  }).toUpperCase();
}

function mobileconfig() {
  if (!tlsBundle) return null;
  var b64 = tlsBundle.caCertDer.toString("base64").replace(/(.{64})/g, "$1\n").trim();
  var uuid1 = profileUuid();
  var uuid2 = profileUuid();
  return '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n' +
    '<plist version="1.0"><dict>\n' +
    '<key>PayloadContent</key><array><dict>\n' +
    '<key>PayloadCertificateFileName</key><string>TheoCarMatch-HomeCA.crt</string>\n' +
    '<key>PayloadContent</key><data>\n' + b64 + '\n</data>\n' +
    '<key>PayloadDescription</key><string>Lets this iPhone open Theo&apos;s Car Match securely on your home Wi-Fi.</string>\n' +
    '<key>PayloadDisplayName</key><string>Theo&apos;s Car Match Home CA</string>\n' +
    '<key>PayloadIdentifier</key><string>lab.knoddy86.theo-car-match.ca</string>\n' +
    '<key>PayloadType</key><string>com.apple.security.root</string>\n' +
    '<key>PayloadUUID</key><string>' + uuid1 + '</string>\n' +
    '<key>PayloadVersion</key><integer>1</integer>\n' +
    '</dict></array>\n' +
    '<key>PayloadDescription</key><string>Install this profile so your iPhone can open Theo&apos;s Car Match over HTTPS on your home Wi-Fi.</string>\n' +
    '<key>PayloadDisplayName</key><string>Theo&apos;s Car Match Home CA</string>\n' +
    '<key>PayloadIdentifier</key><string>lab.knoddy86.theo-car-match.profile</string>\n' +
    '<key>PayloadRemovalDisallowed</key><false/>\n' +
    '<key>PayloadType</key><string>Configuration</string>\n' +
    '<key>PayloadUUID</key><string>' + uuid2 + '</string>\n' +
    '<key>PayloadVersion</key><integer>1</integer>\n' +
    '</dict></plist>\n';
}

function lanLinks(scheme, port) {
  var ips = (tlsBundle && tlsBundle.sans && tlsBundle.sans.ips) ? tlsBundle.sans.ips : lanIPv4();
  var extra = lanIPv4();
  extra.forEach(function (ip) { if (ips.indexOf(ip) === -1) ips.push(ip); });
  return ips.filter(function (ip) { return ip !== "127.0.0.1"; }).map(function (ip) {
    return scheme + "://" + ip + ":" + port + "/";
  });
}

function requestHostName(req) {
  return String(req.headers.host || "").split(":")[0] || "192.168.68.91";
}

function isHttpsReq(req) {
  return !!(req.socket && (req.socket.encrypted || req.socket.authorized));
}

function httpAllowedPath(pathName) {
  var p = pathName.replace(/\/+$/, "") || "/";
  return p === "/setup" || p === "/setup.html" || p === "/ca" || p === "/ca.crt" || p === "/ca.mobileconfig" || p === "/trust-windows.bat" || p === "/trust-windows.ps1";
}

function redirectToHttps(req, res) {
  var host = requestHostName(req);
  var loc = "https://" + host + ":" + HTTPS_PORT + (req.url || "/");
  res.statusCode = 301;
  res.setHeader("Location", loc);
  res.setHeader("Cache-Control", "no-store");
  res.end();
}

function trustWindowsBat(req) {
  var host = requestHostName(req);
  var url = "http://" + host + ":" + PORT + "/ca.crt";
  var httpsGame = "https://" + host + ":" + HTTPS_PORT + "/";
  return (
    "@echo off\r\n" +
    "setlocal\r\n" +
    "set \"URL=" + url + "\"\r\n" +
    "set \"OUT=%TEMP%\\TheoCarMatch-HomeCA.crt\"\r\n" +
    "echo Downloading the Theo's Car Match certificate...\r\n" +
    "curl.exe -fsSL -o \"%OUT%\" \"%URL%\"\r\n" +
    "if errorlevel 1 (\r\n" +
    "  powershell -NoProfile -Command \"try { Invoke-WebRequest -UseBasicParsing -Uri '%URL%' -OutFile '%OUT%' } catch { exit 1 }\"\r\n" +
    ")\r\n" +
    "if not exist \"%OUT%\" (\r\n" +
    "  echo Could not download the certificate. Are you on the home Wi-Fi?\r\n" +
    "  pause\r\n" +
    "  exit /b 1\r\n" +
    ")\r\n" +
    "echo Windows will ask you to confirm. Click Yes to trust this home computer.\r\n" +
    "certutil -addstore -user Root \"%OUT%\"\r\n" +
    "if errorlevel 1 (\r\n" +
    "  echo The certificate was not added.\r\n" +
    "  pause\r\n" +
    "  exit /b 1\r\n" +
    ")\r\n" +
    "echo Done. You can close this window, then open:\r\n" +
    "echo   " + httpsGame + "\r\n" +
    "pause\r\n"
  );
}

function setupPage() {
  var httpsLinks = lanLinks("https", HTTPS_PORT);
  var httpLinks = lanLinks("http", PORT);
  var mainHttp = httpLinks[0] || ("http://192.168.68.91:" + PORT + "/");
  var mainHttps = httpsLinks[0] || ("https://192.168.68.91:" + HTTPS_PORT + "/");
  // Prefer the known home IP if present
  httpLinks.forEach(function (u) { if (u.indexOf("192.168.68.91") !== -1) mainHttp = u; });
  httpsLinks.forEach(function (u) { if (u.indexOf("192.168.68.91") !== -1) mainHttps = u; });
  var httpsHost = mainHttps.replace(/\/$/, "");
  var gameHttps = httpsHost + "/#familyKey=" + encodeURIComponent(FAMILY_KEY);
  return '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">' +
    '<title>Set up Theo&apos;s Car Match on iPhone</title>' +
    '<style>body{font-family:system-ui,Segoe UI,sans-serif;max-width:40rem;margin:2rem auto;padding:0 1.2rem;color:#1A237E;line-height:1.45}' +
    'h1{font-size:1.6rem}ol{padding-left:1.3rem}li{margin:0.7rem 0}' +
    'a.btn{display:inline-block;background:#1565C0;color:#fff;text-decoration:none;font-weight:700;padding:0.7rem 1rem;border-radius:999px}' +
    'code{background:#E8EAF6;padding:0.1em 0.35em;border-radius:6px}p.note{color:#3949AB}</style></head><body>' +
    '<h1>Set up the iPhone app</h1>' +
    '<p>The game on GitHub Pages cannot talk to this computer over plain http. Follow these steps once on the iPhone, while you are on the home Wi-Fi.</p>' +
    '<ol>' +
    '<li>Tap <strong>Download the trust profile</strong> below, then open the file if iOS asks.</li>' +
    '<li>On the iPhone go to <strong>Settings &gt; General &gt; VPN &amp; Device Management</strong>, tap the <strong>Theo&apos;s Car Match Home CA</strong> profile, and tap <strong>Install</strong>.</li>' +
    '<li>Then go to <strong>Settings &gt; General &gt; About &gt; Certificate Trust Settings</strong> and turn on full trust for <strong>Theo&apos;s Car Match Home CA</strong>.</li>' +
    '<li>Open <a href="' + gameHttps + '">' + httpsHost + '/</a> in Safari. The family key is saved automatically the first time.</li>' +
    '<li>Tap the Share button, then <strong>Add to Home Screen</strong>. That icon is the app. It can open and keep working offline, and it will update from this computer when you are home.</li>' +
    '</ol>' +
    '<p><a class="btn" href="/ca">Download the trust profile</a></p>' +
    '<h2>On a Windows PC</h2>' +
    '<p>To get rid of the "not secure" warning in Chrome or Edge, trust this computer once. Download <a href="/trust-windows.bat">Trust this PC</a>, run it, and click Yes if Windows asks. Then open <a href="' + gameHttps + '">' + httpsHost + '/</a>.</p>' +
    '<h2>On a Mac</h2>' +
    '<p>Download <a href="/ca.crt">ca.crt</a>, open it, then in Keychain Access find <strong>Theo&apos;s Car Match Home CA</strong>, open it, and set Trust to Always Trust. Enter your password if asked. Then open the HTTPS link above.</p>' +
    '<h2>On Android</h2>' +
    '<p>Download <a href="/ca.crt">ca.crt</a> in Chrome, then go to Settings &gt; Security &gt; Encryption &amp; credentials &gt; Install a certificate &gt; CA certificate, and choose that file. Then open the HTTPS link above.</p>' +
    '<p class="note">A parent also needs to set a PIN on this computer (open <code>set-pin.bat</code> or <a href="http://127.0.0.1:' + PORT + '/admin">http://127.0.0.1:' + PORT + '/admin</a> on the PC, or <a href="https://127.0.0.1:' + HTTPS_PORT + '/admin">https://127.0.0.1:' + HTTPS_PORT + '/admin</a>). The family key is only for reading. Saving changes from a phone needs that PIN.</p>' +
    '<p class="note">You can also download the certificate as a file: <a href="/ca.crt">ca.crt</a>.</p>' +
    '<script>try{document.cookie="theo_family_key=' + FAMILY_KEY + '; Max-Age=315360000; Path=/; SameSite=Lax";}catch(e){}</script>' +
    '</body></html>';
}

function adminPage(msg, isError) {
  var has = pinStore.hasPin();
  return '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">' +
    '<title>Theo&apos;s Car Match — parent PIN</title>' +
    '<style>body{font-family:system-ui,Segoe UI,sans-serif;max-width:28rem;margin:2.5rem auto;padding:0 1.2rem;color:#1A237E;line-height:1.45}' +
    'label{display:block;font-weight:700;margin:0.8rem 0 0.3rem}' +
    'input{width:100%;font-size:1.1rem;padding:0.5rem 0.6rem;border:3px solid #C5CAE9;border-radius:10px}' +
    'button{margin-top:1rem;background:#1565C0;color:#fff;border:0;border-radius:999px;font-weight:800;font-size:1rem;padding:0.6rem 1.1rem;cursor:pointer}' +
    '.msg{padding:0.6rem 0.8rem;border-radius:10px;font-weight:700}' +
    '.ok{background:#E8F5E9;color:#1B5E20}.err{background:#FFEBEE;color:#B71C1C}</style></head><body>' +
    '<h1>Parent PIN</h1>' +
    '<p>This PIN is needed to save changes from a phone or this browser to the home computer copy. The family key is only for reading.</p>' +
    (msg ? '<p class="msg ' + (isError ? 'err' : 'ok') + '">' + msg + '</p>' : '') +
    '<form method="POST" action="/admin">' +
    (has ? '<label for="current">Current PIN</label><input id="current" name="current" type="password" inputmode="numeric" autocomplete="current-password" required>' : '') +
    '<label for="pin">' + (has ? 'New PIN' : 'Choose a PIN') + '</label>' +
    '<input id="pin" name="pin" type="password" inputmode="numeric" minlength="4" autocomplete="new-password" required>' +
    '<label for="confirm">Type it again</label>' +
    '<input id="confirm" name="confirm" type="password" inputmode="numeric" minlength="4" autocomplete="new-password" required>' +
    '<button type="submit">' + (has ? 'Change PIN' : 'Save PIN') + '</button></form>' +
    '<p>Use at least 4 characters. Open this page only on this computer: <code>http://127.0.0.1:' + PORT + '/admin</code>.</p>' +
    '</body></html>';
}

function handleAdmin(req, res) {
  if (!isLocalRequest(req)) {
    return send(res, 403, "text/plain; charset=utf-8", "The parent PIN can only be set from this computer (http://127.0.0.1:" + PORT + "/admin).");
  }
  if (req.method === "GET" || req.method === "HEAD") {
    return send(res, 200, "text/html; charset=utf-8", adminPage());
  }
  if (req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return send(res, 405, "text/plain; charset=utf-8", "Method not allowed");
  }
  return readRequest(req, 8192).then(function (buf) {
    var type = String(req.headers["content-type"] || "");
    var body = {};
    if (type.indexOf("application/json") !== -1) {
      try { body = JSON.parse(buf.toString("utf8") || "{}"); } catch (e) { body = {}; }
    } else {
      body = querystring.parse(buf.toString("utf8"));
    }
    var current = String(body.current || "");
    var pin = String(body.pin || "");
    var confirm = String(body.confirm || "");
    try {
      if (pinStore.hasPin()) {
        if (!pinStore.verify(current)) {
          return send(res, 200, "text/html; charset=utf-8", adminPage("Current PIN was not accepted.", true));
        }
      }
      if (pin.length < 4) return send(res, 200, "text/html; charset=utf-8", adminPage("Use at least 4 characters.", true));
      if (pin !== confirm) return send(res, 200, "text/html; charset=utf-8", adminPage("The two PINs did not match.", true));
      pinStore.setPin(pin);
      return send(res, 200, "text/html; charset=utf-8", adminPage("The parent PIN was saved. Phones will need this PIN to save changes to this computer."));
    } catch (e) {
      return send(res, 200, "text/html; charset=utf-8", adminPage(e.message || "Could not save the PIN.", true));
    }
  }).catch(function () {
    send(res, 400, "text/plain; charset=utf-8", "Bad request");
  });
}

function handleSpecial(req, res, url) {
  var pathName = url.pathname.replace(/\/+$/, "") || "/";
  if (pathName === "/setup" || pathName === "/setup.html") {
    if (req.method !== "GET" && req.method !== "HEAD") return false;
    send(res, 200, "text/html; charset=utf-8", setupPage());
    return true;
  }
  if (pathName === "/admin") {
    handleAdmin(req, res);
    return true;
  }
  if (pathName === "/ca" || pathName === "/ca.mobileconfig") {
    if (req.method !== "GET" && req.method !== "HEAD") return false;
    var cfg = mobileconfig();
    if (!cfg) return send(res, 503, "text/plain; charset=utf-8", "Certificates are not ready.");
    res.setHeader("Content-Disposition", "attachment; filename=\"TheoCarMatch-HomeCA.mobileconfig\"");
    send(res, 200, "application/x-apple-aspen-config", cfg);
    return true;
  }
  if (pathName === "/ca.crt") {
    if (req.method !== "GET" && req.method !== "HEAD") return false;
    if (!tlsBundle) return send(res, 503, "text/plain; charset=utf-8", "Certificates are not ready.");
    res.setHeader("Content-Disposition", "attachment; filename=\"TheoCarMatch-HomeCA.crt\"");
    send(res, 200, "application/x-x509-ca-cert", tlsBundle.caCertPem);
    return true;
  }
  if (pathName === "/trust-windows.bat") {
    if (req.method !== "GET" && req.method !== "HEAD") return false;
    res.setHeader("Content-Disposition", "attachment; filename=\"Trust-Theos-Car-Match-PC.bat\"");
    send(res, 200, "application/octet-stream", trustWindowsBat(req));
    return true;
  }
  return false;
}

function safeAccessLog(req, res) {
  var done = false;
  function write() {
    if (done) return;
    done = true;
    try {
      var ip = (req.socket && req.socket.remoteAddress) || "";
      var pathOnly = String(req.url || "/").split("?")[0];
      if (pathOnly.length > 160) pathOnly = pathOnly.slice(0, 160);
      var line = new Date().toISOString() + " " + ip + " " + (req.method || "?") + " " + pathOnly + " " + res.statusCode + "\n";
      fs.appendFile(path.join(ROOT, "logs", "access.log"), line, function () {});
    } catch (e) {}
  }
  res.on("finish", write);
  res.on("close", write);
}

function onRequest(req, res) {
  safeAccessLog(req, res);
  setCors(req, res);
  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    return res.end();
  }
  var url;
  try { url = new URL(req.url, "http://127.0.0.1"); } catch (e) {
    return send(res, 400, "text/plain; charset=utf-8", "Bad request");
  }
  if (!isHttpsReq(req)) {
    var pathName = url.pathname.replace(/\/+$/, "") || "/";
    var allowHttp = httpAllowedPath(pathName) || (pathName === "/admin" && isLocalRequest(req));
    if (!allowHttp) {
      redirectToHttps(req, res);
      return;
    }
  }
  try {
    if (handleSpecial(req, res, url)) return;
  } catch (e) {
    console.error(e);
    if (!res.headersSent) sendJson(res, 500, { ok: false, error: "server error" });
    return;
  }
  if (url.pathname === "/api" || url.pathname.indexOf("/api/") === 0) {
    try { return handleApi(req, res, url); } catch (e) {
      console.error(e);
      if (!res.headersSent) sendJson(res, 500, { ok: false, error: "server error" });
      return;
    }
  }
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.setHeader("Allow", "GET, HEAD");
    return send(res, 405, "text/plain; charset=utf-8", "Method not allowed");
  }
  serveGame(req, res, url.pathname);
}


var server = http.createServer(onRequest);
var httpsServer = null;
server.keepAliveTimeout = 30000;
server.headersTimeout = 35000;

function printBanner() {
  var ips = lanIPv4();
  console.log("");
  console.log("  Theo's Car Match — family sync server");
  console.log("  =====================================");
  console.log("  On this computer:     http://127.0.0.1:" + PORT + "/");
  console.log("  Set or change PIN:    http://127.0.0.1:" + PORT + "/admin");
  if (ips.length) {
    ips.forEach(function (ip) {
      console.log("  iPhone setup (http):  http://" + ip + ":" + PORT + "/setup");
      console.log("  iPhone app (https):   https://" + ip + ":" + HTTPS_PORT + "/");
    });
  } else {
    console.log("  iPhone setup (http):  http://192.168.68.91:" + PORT + "/setup");
    console.log("  iPhone app (https):   https://192.168.68.91:" + HTTPS_PORT + "/");
  }
  if (tlsBundle && tlsBundle.regenerated) {
    console.log("");
    console.log("  HTTPS certificate was created or renewed for: " + (tlsBundle.sans.ips.concat(tlsBundle.sans.dns).join(", ")));
  }
  console.log("");
  console.log("  Family key (type this in the game Settings):");
  console.log("  " + FAMILY_KEY);
  console.log("");
  if (!pinStore.hasPin()) {
    console.log("  No parent PIN yet. On this PC, open http://127.0.0.1:" + PORT + "/admin or run set-pin.bat.");
    console.log("");
  }
  console.log("  Leave this window open while you play. Ctrl+C to stop.");
  console.log("");
}

server.listen(PORT, HOST, function () {
  if (!tlsBundle) {
    printBanner();
    console.log("  HTTPS is not available (certificate setup failed). HTTP still works.");
    console.log("");
    return;
  }
  httpsServer = https.createServer({
    cert: tlsBundle.serverCertPem,
    key: tlsBundle.serverKeyPem,
    ca: tlsBundle.caCertPem
  }, onRequest);
  httpsServer.keepAliveTimeout = 30000;
  httpsServer.headersTimeout = 35000;
  httpsServer.listen(HTTPS_PORT, HOST, function () {
    printBanner();
  });
  httpsServer.on("error", function (err) {
    console.error("HTTPS server error:", err && err.message ? err.message : err);
    printBanner();
  });
});

function shutdown() {
  var left = 1;
  function done() { left--; if (left <= 0) process.exit(0); }
  server.close(done);
  if (httpsServer) { left++; httpsServer.close(done); }
  setTimeout(function () { process.exit(0); }, 1500).unref();
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
