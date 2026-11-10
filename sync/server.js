#!/usr/bin/env node
"use strict";

var http = require("http");
var fs = require("fs");
var path = require("path");
var crypto = require("crypto");
var os = require("os");

var ROOT = path.resolve(__dirname);
var DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(ROOT, "data"));
var GAME_DIR = path.resolve(process.env.GAME_DIR || path.join(ROOT, "game"));
var CARDS_DIR = path.join(DATA_DIR, "cards");
var KEY_FILE = path.join(DATA_DIR, "family-key.txt");
var PORT = parseInt(process.env.PORT || "8787", 10);
var HOST = process.env.HOST || "0.0.0.0";
var MAX_JSON = 512 * 1024;
var MAX_BLOB = 12 * 1024 * 1024;
var PAGES_ORIGIN = "https://knoddy86-lab.github.io";
var ID_RE = /^[a-zA-Z0-9_-]{1,80}$/;

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
  ".txt": "text/plain; charset=utf-8"
};

function ensureDirs() {
  fs.mkdirSync(CARDS_DIR, { recursive: true });
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

function allowedOrigin(origin) {
  if (!origin) return null;
  if (origin === PAGES_ORIGIN) return origin;
  if (process.env.ALLOW_LOCAL === "1") {
    if (/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(origin)) return origin;
  }
  return null;
}

function setCors(req, res) {
  var origin = allowedOrigin(req.headers.origin);
  if (origin) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type, X-Family-Key");
    res.setHeader("Access-Control-Allow-Methods", "GET, PUT, POST, DELETE, OPTIONS");
    res.setHeader("Access-Control-Max-Age", "86400");
  }
}

function send(res, code, type, body, extra) {
  res.statusCode = code;
  if (type) res.setHeader("Content-Type", type);
  res.setHeader("Cache-Control", "no-store");
  if (extra) Object.keys(extra).forEach(function (k) { res.setHeader(k, extra[k]); });
  res.end(body);
}

function sendJson(res, code, obj) {
  send(res, code, "application/json; charset=utf-8", JSON.stringify(obj));
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
}

function blobInfo(id, kind) {
  var p = cardPath(id, kind);
  if (!p || !fs.existsSync(p)) return { has: false, size: 0, type: "" };
  var tp = cardPath(id, kind + "-type");
  var type = "";
  try { if (tp && fs.existsSync(tp)) type = fs.readFileSync(tp, "utf8").trim(); } catch (e) {}
  return { has: true, size: fs.statSync(p).size, type: type };
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
}

function saveBlob(id, kind, buf, type, updatedAt) {
  var file = cardPath(id, kind);
  var typeFile = cardPath(id, kind + "-type");
  fs.writeFileSync(file, buf);
  fs.writeFileSync(typeFile, (type || "application/octet-stream").split(";")[0].slice(0, 80));
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
    res.setHeader("Cache-Control", ext === ".html" ? "no-store" : "public, max-age=3600");
    fs.createReadStream(file).pipe(res);
  });
}

function handleApi(req, res, url) {
  var parts = url.pathname.replace(/\/+$/, "").split("/").filter(Boolean);
  // parts[0] === "api"
  if (req.method === "GET" && parts.length === 2 && parts[1] === "health") {
    return sendJson(res, 200, { ok: true, service: "theo-sync", version: 1 });
  }
  if (!authorized(req)) return sendJson(res, 401, { ok: false, error: "bad key" });

  if (req.method === "GET" && parts.length === 2 && parts[1] === "sync") {
    var cards = {};
    listIds().forEach(function (id) { cards[id] = publicCard(id); });
    return sendJson(res, 200, { ok: true, cards: cards });
  }

  if (parts.length >= 3 && parts[1] === "cards") {
    var id = parts[2];
    if (!ID_RE.test(id)) return sendJson(res, 400, { ok: false, error: "bad id" });
    var kind = parts[3]; // image | audio | undefined

    if (req.method === "GET" && !kind) return sendJson(res, 200, { ok: true, card: publicCard(id) });

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

var server = http.createServer(function (req, res) {
  setCors(req, res);
  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    return res.end();
  }
  var url;
  try { url = new URL(req.url, "http://127.0.0.1"); } catch (e) {
    return send(res, 400, "text/plain; charset=utf-8", "Bad request");
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
});

server.listen(PORT, HOST, function () {
  var ips = lanIPv4();
  console.log("");
  console.log("  Theo's Car Match — family sync server");
  console.log("  =====================================");
  console.log("  On this computer:   http://127.0.0.1:" + PORT + "/");
  if (ips.length) {
    ips.forEach(function (ip) {
      console.log("  On your Wi-Fi:      http://" + ip + ":" + PORT + "/");
    });
  } else {
    console.log("  On your Wi-Fi:      http://<this-PC-LAN-IP>:" + PORT + "/");
  }
  console.log("");
  console.log("  Family key (type this in the game Settings):");
  console.log("  " + FAMILY_KEY);
  console.log("");
  console.log("  Open the Wi-Fi address on the iPhone (not the GitHub Pages site).");
  console.log("  Leave this window open while you play. Ctrl+C to stop.");
  console.log("");
});

function shutdown() {
  server.close(function () { process.exit(0); });
  setTimeout(function () { process.exit(0); }, 1000).unref();
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
