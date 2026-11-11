"use strict";
// Family photo cache for Theo's Car Match.
// Reads Lindsay's Immich READ-ONLY (GET requests plus the read-only metadata search),
// resizes the chosen pictures to small JPEGs under data\photos, and serves only those
// cached files to the game. The Immich API key never leaves this process.

var http = require("http");
var https = require("https");
var fs = require("fs");
var path = require("path");
var os = require("os");
var crypto = require("crypto");
var childProcess = require("child_process");

var DEFAULT_PEOPLE = [
  { match: "Lindsay Knott", name: "Lindsay" },
  { match: "Caitlyn Turnbull", name: "Caitlyn" },
  { match: "Theo Knott", name: "Theo" },
  { match: "Ashley Knott", name: "Ashley" },
  { match: "Ashleigh Mullen", name: "Ashleigh" },
  { match: "Mitch Mullen", name: "Mitch" },
  { match: "Marissa Turnbull", name: "Nanna" },
  { match: "Jason Turnbull", name: "Grandad" },
  { match: "Jayden Turnbull", name: "Jayden" },
  { match: "Josh Turnbull", name: "Josh" },
  { match: "Kelly", name: "Kelly" },
  { match: "Harper Mullen", name: "Harper" },
  { match: "Delilah Turnbull", name: "Delilah" }
];

var FILE_RE = /^[a-z0-9-]{1,40}-[a-f0-9]{12}\.jpg$/;

function PhotoStore(opts) {
  this.dataDir = opts.dataDir;
  this.rootDir = opts.rootDir;
  this.dir = path.join(this.dataDir, "photos");
  this.configFile = path.join(this.dataDir, "photo-people.json");
  this.approvedFile = path.join(this.dataDir, "photo-approved.json");
  this.indexFile = path.join(this.dir, "index.json");
  this.pendingDir = path.join(this.dir, "pending");
  this.immichUrl = process.env.IMMICH_URL || "http://127.0.0.1:2283";
  this.keyFile = process.env.IMMICH_KEY_FILE || path.join(os.homedir(), ".immich", "immich_api_key.txt");
  this.refreshing = null;
  this.lastError = "";
  this.lastReport = null;
  fs.mkdirSync(this.dir, { recursive: true });
  this.ensureConfig();
  this.index = this.readIndex();
}

PhotoStore.prototype.ensureConfig = function () {
  if (fs.existsSync(this.configFile)) return;
  var cfg = {
    _help: "People for the PHOTOS game. 'match' is the person's name in Immich, 'name' is what the game shows and says. Add asset ids to 'skipAssets' to leave a photo out. Changes apply on the next photo refresh.",
    perPerson: 12,
    refreshHours: 24,
    people: DEFAULT_PEOPLE,
    skipAssets: []
  };
  fs.writeFileSync(this.configFile, JSON.stringify(cfg, null, 2));
};

PhotoStore.prototype.readConfig = function () {
  var raw = {};
  try { raw = JSON.parse(fs.readFileSync(this.configFile, "utf8")); } catch (e) { raw = {}; }
  var people = Array.isArray(raw.people) && raw.people.length ? raw.people : DEFAULT_PEOPLE;
  return {
    perPerson: Math.max(1, Math.min(30, parseInt(raw.perPerson, 10) || 12)),
    refreshHours: Math.max(1, Math.min(24 * 14, parseInt(raw.refreshHours, 10) || 24)),
    people: people.filter(function (p) { return p && p.match; }).map(function (p) {
      return { match: String(p.match).trim(), name: String(p.name || p.match).trim().slice(0, 40), say: p.say ? String(p.say).trim().slice(0, 60) : "",
        first: typeof p.first === "string" ? p.first : null, last: typeof p.last === "string" ? p.last : null, nick: typeof p.nick === "string" ? p.nick : null };
    }),
    skipAssets: Array.isArray(raw.skipAssets) ? raw.skipAssets.map(String) : [],
    faceAssets: raw.faceAssets && typeof raw.faceAssets === "object" ? raw.faceAssets : {}
  };
};

PhotoStore.prototype.patchConfig = function (fn) {
  var raw = {};
  try { raw = JSON.parse(fs.readFileSync(this.configFile, "utf8")); } catch (e) { raw = {}; }
  fn(raw);
  fs.writeFileSync(this.configFile + ".tmp", JSON.stringify(raw, null, 2));
  fs.renameSync(this.configFile + ".tmp", this.configFile);
};

// Safety-reviewed photos per person (asset ids). When this file exists, ONLY these
// assets are used in the game; anything new has to be reviewed and added first.
PhotoStore.prototype.readApproved = function () {
  try {
    var j = JSON.parse(fs.readFileSync(this.approvedFile, "utf8"));
    if (j && j.people && typeof j.people === "object") return j;
  } catch (e) {}
  return null;
};

PhotoStore.prototype.patchApproved = function (fn) {
  var raw = this.readApproved();
  if (!raw) return;
  fn(raw);
  fs.writeFileSync(this.approvedFile + ".tmp", JSON.stringify(raw, null, 2));
  fs.renameSync(this.approvedFile + ".tmp", this.approvedFile);
};

// 64-bit dHash per file (hex), via photo-hash.ps1. Read-only.
PhotoStore.prototype.hashFiles = function (files) {
  var self = this;
  if (!files.length) return Promise.resolve({});
  var listFile = path.join(this.dir, "_hash.json");
  fs.writeFileSync(listFile, JSON.stringify(files));
  var script = path.join(this.rootDir, "photo-hash.ps1");
  return new Promise(function (resolve) {
    childProcess.execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", script, listFile], { windowsHide: true, timeout: 10 * 60 * 1000, maxBuffer: 8 * 1024 * 1024 }, function (err, stdout) {
      try { fs.unlinkSync(listFile); } catch (e) {}
      var out = {};
      if (!err) { try { out = JSON.parse(String(stdout || "{}")); } catch (e) { out = {}; } }
      resolve(out);
    });
  });
};

PhotoStore.prototype.readIndex = function () {
  try {
    var j = JSON.parse(fs.readFileSync(this.indexFile, "utf8"));
    if (j && Array.isArray(j.people)) return j;
  } catch (e) {}
  return { refreshedAt: 0, etag: "", people: [], report: null };
};

// First / last / nickname per person (v31). Defaults: first name = the Immich name, nickname =
// the display name when it differs (Nanna, Grandad); last names start blank.
function nameParts(c) {
  var match = String((c && c.match) || "").trim();
  var name = String((c && c.name) || match).trim();
  var firstWord = match.split(/\s+/)[0] || name;
  return {
    first: c && c.first !== null && c.first !== undefined ? c.first : firstWord,
    last: c && c.last !== null && c.last !== undefined ? c.last : "",
    nick: c && c.nick !== null && c.nick !== undefined ? c.nick : (name && name.toLowerCase() !== firstWord.toLowerCase() ? name : "")
  };
}

PhotoStore.prototype.manifest = function () {
  var idx = this.index;
  var cfg = this.readConfig();
  var byName = {};
  cfg.people.forEach(function (c) { byName[c.name] = c; });
  var people = (idx.people || []).map(function (p) {
    var solo = (p.items || []).filter(function (it) { return it.faces === 1; }).map(function (it) { return it.file; });
    var np = nameParts(byName[p.name] || { match: p.name, name: p.name });
    return { id: p.id, name: p.name, say: p.say || p.name, first: np.first, last: np.last, nick: np.nick, face: p.face || "", photos: (p.photos || []).slice(), looks: p.looks || {}, solo: solo };
  });
  var tag = (idx.etag || "") + "-" + crypto.createHash("sha1").update(JSON.stringify(people.map(function (p) { return [p.id, p.first, p.last, p.nick]; }))).digest("hex").slice(0, 8);
  return { ok: true, etag: tag, refreshedAt: idx.refreshedAt || 0, people: people };
};

function cleanNamePart(v) {
  return String(v == null ? "" : v).replace(/[\u0000-\u001f\u007f<>]/g, "").replace(/\s+/g, " ").trim().slice(0, 40);
}

// Parent edits a person's names; every device gets them with the next manifest.
PhotoStore.prototype.setNames = function (personId, first, last, nick) {
  var person = findPerson(this.index, String(personId || ""));
  if (!person) return Promise.reject(Object.assign(new Error("Unknown person."), { code: 404 }));
  var f = cleanNamePart(first), l = cleanNamePart(last), n = cleanNamePart(nick);
  if (!f && !n) return Promise.reject(Object.assign(new Error("Give a first name or a nickname."), { code: 400 }));
  var found = false;
  this.patchConfig(function (raw) {
    raw.people = Array.isArray(raw.people) && raw.people.length ? raw.people : DEFAULT_PEOPLE.map(function (x) { return Object.assign({}, x); });
    raw.people.forEach(function (c) {
      if (c && String(c.name || c.match).trim() === person.name) { c.first = f; c.last = l; c.nick = n; found = true; }
    });
  });
  if (!found) return Promise.reject(Object.assign(new Error("That person isn't in photo-people.json."), { code: 404 }));
  return Promise.resolve(this.manifest());
};

PhotoStore.prototype.status = function () {
  var idx = this.index;
  return {
    ok: true,
    refreshing: !!this.refreshing,
    refreshedAt: idx.refreshedAt || 0,
    lastError: this.lastError || "",
    people: (idx.people || []).map(function (p) { return { name: p.name, photos: (p.photos || []).length, face: !!p.face }; }),
    report: idx.report || null
  };
};

PhotoStore.prototype.filePath = function (name) {
  if (!FILE_RE.test(name)) return null;
  var p = path.join(this.dir, name);
  return fs.existsSync(p) ? p : null;
};

PhotoStore.prototype.readKey = function () {
  var key = fs.readFileSync(this.keyFile, "utf8").trim();
  if (!key) throw new Error("Immich key file is empty");
  return key;
};

// Only GET, plus POST to the read-only metadata search, are ever sent to Immich.
PhotoStore.prototype.immich = function (method, apiPath, body, wantBuffer) {
  if (!(method === "GET" || (method === "POST" && apiPath === "/api/search/metadata"))) {
    return Promise.reject(new Error("blocked non-read Immich call"));
  }
  var key, base;
  try {
    key = this.readKey();
    base = new URL(this.immichUrl);
  } catch (e) {
    return Promise.reject(new Error(e && e.code === "ENOENT" ? "Immich key file not found" : "Immich settings problem"));
  }
  var lib = base.protocol === "https:" ? https : http;
  return new Promise(function (resolve, reject) {
    var payload = body ? Buffer.from(JSON.stringify(body)) : null;
    var headers = { "x-api-key": key, Accept: wantBuffer ? "image/*" : "application/json" };
    if (payload) { headers["Content-Type"] = "application/json"; headers["Content-Length"] = payload.length; }
    var req = lib.request({ hostname: base.hostname, port: base.port || (base.protocol === "https:" ? 443 : 80), path: apiPath, method: method, headers: headers, timeout: 30000 }, function (res) {
      var chunks = [];
      res.on("data", function (c) { chunks.push(c); });
      res.on("end", function () {
        var buf = Buffer.concat(chunks);
        if (res.statusCode < 200 || res.statusCode >= 300) return reject(new Error("Immich " + method + " " + apiPath.split("?")[0].replace(/[0-9a-f-]{36}/g, ":id") + " returned " + res.statusCode));
        if (wantBuffer) return resolve({ buf: buf, type: String(res.headers["content-type"] || "") });
        try { resolve(JSON.parse(buf.toString("utf8"))); } catch (e) { reject(new Error("Immich sent bad JSON")); }
      });
    });
    req.on("timeout", function () { req.destroy(new Error("Immich timed out")); });
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
};

function slugify(s) {
  return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "person";
}

function norm(s) { return String(s || "").trim().replace(/\s+/g, " ").toLowerCase(); }

function matchPeople(cfgPeople, immichPeople) {
  var out = [];
  var problems = [];
  cfgPeople.forEach(function (cp) {
    var want = norm(cp.match);
    var exact = immichPeople.filter(function (p) { return norm(p.name) === want; });
    var hits = exact;
    if (!hits.length && want.indexOf(" ") === -1) {
      hits = immichPeople.filter(function (p) { return norm(p.name).split(" ")[0] === want; });
    }
    if (hits.length === 1) out.push({ cfg: cp, person: hits[0] });
    else if (!hits.length) problems.push({ name: cp.name, match: cp.match, problem: "not found in Immich" });
    else problems.push({ name: cp.name, match: cp.match, problem: "ambiguous: " + hits.map(function (h) { return String(h.name).trim(); }).join(", ") });
  });
  return { matched: out, problems: problems };
}

function faceStats(faces, personId) {
  var mine = null;
  var count = 0;
  (faces || []).forEach(function (f) {
    count += 1;
    if (f.person && f.person.id === personId) {
      var w = Math.max(1, f.imageWidth || 1), h = Math.max(1, f.imageHeight || 1);
      var box = {
        x1: Math.max(0, f.boundingBoxX1 / w), y1: Math.max(0, f.boundingBoxY1 / h),
        x2: Math.min(1, f.boundingBoxX2 / w), y2: Math.min(1, f.boundingBoxY2 / h),
        iw: w, ih: h
      };
      var area = (box.x2 - box.x1) * (box.y2 - box.y1);
      if (!mine || area > mine.area) mine = { box: box, area: area };
    }
  });
  return { mine: mine, count: count };
}

// Square crop (fractions of the image) centred on the person.
// "photo": a wide shot around them (whole photo when they fill it); "face": a close face crop.
function squareCrop(box, mode) {
  var iw = box.iw, ih = box.ih;
  var shortSide = Math.min(iw, ih);
  var fx = (box.x1 + box.x2) / 2 * iw, fy = (box.y1 + box.y2) / 2 * ih;
  var faceSide = Math.max((box.x2 - box.x1) * iw, (box.y2 - box.y1) * ih);
  var side, cy;
  if (mode === "face") {
    side = Math.min(shortSide, Math.max(faceSide * 2.1, 48));
    cy = fy;
  } else {
    side = Math.min(shortSide, Math.max(faceSide * 4.5, shortSide * 0.3));
    cy = fy + side * 0.1;
  }
  var x = Math.max(0, Math.min(iw - side, fx - side / 2));
  var y = Math.max(0, Math.min(ih - side, cy - side / 2));
  return { x: x / iw, y: y / ih, w: side / iw, h: side / ih };
}

function smallFace(box) {
  var shortSide = Math.min(box.iw, box.ih);
  var faceSide = Math.max((box.x2 - box.x1) * box.iw, (box.y2 - box.y1) * box.ih);
  return faceSide / shortSide < 0.15;
}

PhotoStore.prototype.resizeBatch = function (jobs) {
  var self = this;
  if (!jobs.length) return Promise.resolve();
  var jobFile = path.join(this.dir, "_jobs.json");
  fs.writeFileSync(jobFile, JSON.stringify(jobs));
  var script = path.join(this.rootDir, "photo-resize.ps1");
  return new Promise(function (resolve, reject) {
    childProcess.execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", script, jobFile], { windowsHide: true, timeout: 15 * 60 * 1000, maxBuffer: 4 * 1024 * 1024 }, function (err, stdout, stderr) {
      try { fs.unlinkSync(jobFile); } catch (e) {}
      if (err) return reject(new Error("resize failed: " + String(stderr || err.message).slice(0, 300)));
      resolve(String(stdout || ""));
    });
  });
};

PhotoStore.prototype.refresh = function (reason) {
  var self = this;
  if (this.refreshing) return this.refreshing;
  var cfg = this.readConfig();
  var skip = {};
  cfg.skipAssets.forEach(function (id) { skip[id] = true; });
  var tmp = path.join(this.dir, "_tmp");
  var approved = this.readApproved();
  var report = { at: Date.now(), reason: reason || "", people: [], problems: [], approvedOnly: !!approved };
  this.refreshing = this.immich("GET", "/api/people?size=1000&withHidden=false").then(function (j) {
    var list = (j && (j.people || j)) || [];
    var m = matchPeople(cfg.people, list);
    report.problems = m.problems;
    fs.rmSync(tmp, { recursive: true, force: true });
    fs.mkdirSync(tmp, { recursive: true });
    var jobs = [];
    var people = [];
    var chain = Promise.resolve();
    var usedSlugs = {};
    m.matched.forEach(function (hit) {
      chain = chain.then(function () {
        var slug = slugify(hit.cfg.name);
        while (usedSlugs[slug]) slug += "x";
        usedSlugs[slug] = true;
        var approvedIds = approved ? (approved.people[hit.cfg.name] || []) : null;
        var getItems = approvedIds ? self.approvedItems(hit.person.id, approvedIds, 1000, skip) : self.pickPhotos(hit.person.id, cfg.perPerson, skip);
        return getItems.then(function (picked) {
          var entry = { id: slug, name: hit.cfg.name, say: hit.cfg.say || hit.cfg.name, immichName: String(hit.person.name).trim(), totalAssets: picked.total, chosen: picked.items };
          people.push(entry);
          var faceCfg = cfg.faceAssets[hit.cfg.name];
          var faceIdx = -1;
          if (faceCfg !== "none") {
            picked.items.forEach(function (it, i) { if (faceIdx < 0 && faceCfg && it.id === faceCfg) faceIdx = i; });
            if (faceIdx < 0 && picked.items.length) faceIdx = 0;
          }
          entry.faceNone = faceCfg === "none";
          var dl = Promise.resolve();
          picked.items.forEach(function (it, i) {
            dl = dl.then(function () {
              var useOriginal = smallFace(it.box) && /^image\/(jpeg|png)$/i.test(it.mime || "");
              var url = useOriginal ? "/api/assets/" + it.id + "/original" : "/api/assets/" + it.id + "/thumbnail?size=preview";
              return self.immich("GET", url, null, true).then(function (img) {
                if (!/jpe?g|png|bmp|gif/i.test(img.type)) { it.skip = "type " + img.type; return; }
                var src = path.join(tmp, slug + "-" + i + ".src");
                fs.writeFileSync(src, img.buf);
                it.src = src;
                it.out = path.join(tmp, slug + "-p" + i + ".jpg");
                jobs.push({ in: src, out: it.out, crop: squareCrop(it.box, "photo"), size: 512, quality: 80, orient: useOriginal });
                if (i === faceIdx) {
                  entry.faceAsset = it.id;
                  entry.faceOut = path.join(tmp, slug + "-face.jpg");
                  jobs.push({ in: src, out: entry.faceOut, crop: squareCrop(it.box, "face"), size: 512, quality: 82, orient: useOriginal });
                }
              }).catch(function (e) { it.skip = e.message; });
            });
          });
          return dl.then(function () {
            if (entry.faceOut || entry.faceNone) return;
            return self.immich("GET", "/api/people/" + hit.person.id + "/thumbnail", null, true).then(function (img) {
              var src = path.join(tmp, slug + "-face.src");
              fs.writeFileSync(src, img.buf);
              entry.faceOut = path.join(tmp, slug + "-face.jpg");
              jobs.push({ in: src, out: entry.faceOut, crop: null, size: 512, quality: 82 });
            }).catch(function () {});
          });
        });
      });
    });
    return chain.then(function () {
      return self.resizeBatch(jobs);
    }).then(function () {
      var keep = {};
      var outPeople = [];
      function place(tmpFile, slug) {
        if (!tmpFile || !fs.existsSync(tmpFile)) return "";
        var buf = fs.readFileSync(tmpFile);
        if (!buf.length) return "";
        var name = slug + "-" + crypto.createHash("sha1").update(buf).digest("hex").slice(0, 12) + ".jpg";
        var dest = path.join(self.dir, name);
        if (!fs.existsSync(dest)) fs.writeFileSync(dest, buf);
        keep[name] = true;
        return name;
      }
      people.forEach(function (p) {
        var photos = [];
        var items = [];
        p.chosen.forEach(function (it) {
          if (it.skip) return;
          var n = place(it.out, p.id);
          if (n) { photos.push(n); items.push({ file: n, asset: it.id, box: it.box, mime: it.mime || "", when: it.when || 0, day: dayKey(it.localDate || it.when), faces: it.faces || 0 }); }
        });
        var face = place(p.faceOut, p.id);
        outPeople.push({ id: p.id, name: p.name, say: p.say, face: face, faceAsset: face ? (p.faceAsset || "") : "", photos: photos, items: items });
        report.people.push({ name: p.name, immichName: p.immichName, immichPhotos: p.totalAssets, cached: photos.length, face: !!face });
      });
      return self.hashFiles(Object.keys(keep).map(function (f) { return path.join(self.dir, f); })).then(function (hashes) {
      outPeople.forEach(function (p) { p.items.forEach(function (it) { it.hash = hashes[path.join(self.dir, it.file)] || ""; }); });
      computeLooks(outPeople);
      var etag = crypto.createHash("sha1").update(JSON.stringify(outPeople)).digest("hex").slice(0, 16);
      var idx = { refreshedAt: Date.now(), etag: etag, people: outPeople, report: report };
      fs.writeFileSync(self.indexFile + ".tmp", JSON.stringify(idx, null, 2));
      fs.renameSync(self.indexFile + ".tmp", self.indexFile);
      self.index = idx;
      fs.readdirSync(self.dir).forEach(function (f) {
        if (FILE_RE.test(f) && !keep[f]) { try { fs.unlinkSync(path.join(self.dir, f)); } catch (e) {} }
      });
      fs.rmSync(tmp, { recursive: true, force: true });
      self.lastError = "";
      return self.status();
      });
    });
  }).catch(function (e) {
    self.lastError = String(e && e.message || e).slice(0, 300);
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (x) {}
    console.error("Photo refresh failed:", self.lastError);
    return self.status();
  }).then(function (st) {
    self.refreshing = null;
    return st;
  });
  return this.refreshing;
};

// Choose up to n photos where this person is the main (ideally only) face.
PhotoStore.prototype.pickPhotos = function (personId, n, skip) {
  var self = this;
  var all = [];
  var total = 0;
  function page(p) {
    return self.immich("POST", "/api/search/metadata", { personIds: [personId], type: "IMAGE", withPeople: true, size: 500, page: p, order: "desc" }).then(function (j) {
      var a = (j && j.assets) || {};
      total = Math.max(total, a.total || 0);
      (a.items || []).forEach(function (it) { all.push(it); });
      if (a.nextPage && p < 4) return page(p + 1);
    });
  }
  return page(1).then(function () {
    return self.immich("GET", "/api/people/" + personId + "/statistics").then(function (st) {
      if (st && st.assets) total = st.assets;
    }).catch(function () {});
  }).then(function () {
    var usable = all.filter(function (a) {
      return a.type === "IMAGE" && !a.isTrashed && !a.isArchived && !a.isOffline && (!a.visibility || a.visibility === "timeline") && !skip[a.id];
    });
    var solo = usable.filter(function (a) { return (a.people || []).length === 1; });
    var duo = usable.filter(function (a) { return (a.people || []).length === 2; });
    var base = solo.length >= n * 2 ? solo : solo.concat(duo);
    if (base.length < n * 2) {
      var crowd = usable.filter(function (a) { return (a.people || []).length > 2; });
      crowd.sort(function (x, y) { return (x.people || []).length - (y.people || []).length; });
      base = base.concat(crowd.slice(0, n * 3));
    }
    // spread candidates across time so the set isn't one afternoon
    var cands = [];
    var want = Math.min(base.length, Math.max(n * 4, 24));
    for (var i = 0; i < want; i++) cands.push(base[Math.floor(i * base.length / want)]);
    var scored = [];
    var chain = Promise.resolve();
    cands.forEach(function (a) {
      chain = chain.then(function () {
        return self.immich("GET", "/api/faces?id=" + a.id).then(function (faces) {
          var st = faceStats(faces, personId);
          if (!st.mine || st.mine.area < 0.0005) return;
          var score = Math.sqrt(st.mine.area) / Math.pow(st.count, 1.3);
          scored.push({ id: a.id, mime: a.originalMimeType || "", when: Date.parse(a.localDateTime || a.fileCreatedAt || 0) || 0, localDate: a.localDateTime || a.fileCreatedAt || "", box: st.mine.box, score: score, faces: st.count });
        }).catch(function () {});
      });
    });
    return chain.then(function () {
      return { total: total, items: diversePick(scored, n, []) };
    });
  });
};

PhotoStore.prototype.saveIndex = function () {
  var idx = this.index;
  computeLooks(idx.people || []);
  idx.etag = crypto.createHash("sha1").update(JSON.stringify((idx.people || []).map(function (p) { return [p.id, p.name, p.say, p.face, p.photos, p.looks]; }))).digest("hex").slice(0, 16);
  fs.writeFileSync(this.indexFile + ".tmp", JSON.stringify(idx, null, 2));
  fs.renameSync(this.indexFile + ".tmp", this.indexFile);
};

PhotoStore.prototype.fileInUse = function (name) {
  return (this.index.people || []).some(function (p) { return p.face === name || (p.photos || []).indexOf(name) !== -1; });
};

PhotoStore.prototype.unlinkIfUnused = function (name) {
  if (!name || !FILE_RE.test(name) || this.fileInUse(name)) return;
  try { fs.unlinkSync(path.join(this.dir, name)); } catch (e) {}
};

function findPerson(idx, personId) {
  return (idx.people || []).filter(function (p) { return p.id === personId; })[0] || null;
}

// Remove one photo from the game for every device. Immich is never changed:
// the asset id goes on skipAssets so a refresh won't pick it again.
PhotoStore.prototype.deletePhoto = function (file) {
  if (this.refreshing) return Promise.reject(Object.assign(new Error("Photos are refreshing. Try again in a minute."), { code: 409 }));
  if (!FILE_RE.test(String(file || ""))) return Promise.reject(Object.assign(new Error("bad photo"), { code: 400 }));
  var person = (this.index.people || []).filter(function (p) { return (p.photos || []).indexOf(file) !== -1; })[0];
  if (!person) return Promise.reject(Object.assign(new Error("That photo is not in the game."), { code: 404 }));
  var item = (person.items || []).filter(function (it) { return it.file === file; })[0];
  if (item && item.asset) {
    this.patchConfig(function (raw) {
      raw.skipAssets = Array.isArray(raw.skipAssets) ? raw.skipAssets : [];
      if (raw.skipAssets.indexOf(item.asset) === -1) raw.skipAssets.push(item.asset);
    });
    this.patchApproved(function (raw) {
      Object.keys(raw.people).forEach(function (n) {
        if (Array.isArray(raw.people[n])) raw.people[n] = raw.people[n].filter(function (id) { return id !== item.asset; });
      });
    });
  }
  // The same picture can be cropped for several people (group shots): remove it for everyone now.
  var gone = [file];
  (this.index.people || []).forEach(function (p) {
    (p.items || []).forEach(function (it) { if (it.file === file || (item && item.asset && it.asset === item.asset)) gone.push(it.file); });
    p.photos = (p.photos || []).filter(function (f) { return gone.indexOf(f) === -1; });
    p.items = (p.items || []).filter(function (it) { return gone.indexOf(it.file) === -1; });
  });
  this.saveIndex();
  var self = this;
  gone.forEach(function (f) { self.unlinkIfUnused(f); });
  return Promise.resolve(this.manifest());
};

// Change a person's face card: "none", or a face crop made from one of their game photos.
PhotoStore.prototype.setFace = function (personId, use) {
  var self = this;
  if (this.refreshing) return Promise.reject(Object.assign(new Error("Photos are refreshing. Try again in a minute."), { code: 409 }));
  var person = findPerson(this.index, String(personId || ""));
  if (!person) return Promise.reject(Object.assign(new Error("Unknown person."), { code: 404 }));
  var oldFace = person.face;
  if (use === "none") {
    this.patchConfig(function (raw) { raw.faceAssets = raw.faceAssets && typeof raw.faceAssets === "object" ? raw.faceAssets : {}; raw.faceAssets[person.name] = "none"; });
    person.face = "";
    person.faceAsset = "";
    this.saveIndex();
    this.unlinkIfUnused(oldFace);
    return Promise.resolve(this.manifest());
  }
  var item = (person.items || []).filter(function (it) { return it.file === use; })[0];
  if (!item || !item.asset || !item.box) return Promise.reject(Object.assign(new Error("Pick one of this person's photos."), { code: 400 }));
  var tmp = path.join(this.dir, "_face");
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.mkdirSync(tmp, { recursive: true });
  var useOriginal = smallFace(item.box) && /^image\/(jpeg|png)$/i.test(item.mime || "");
  var url = useOriginal ? "/api/assets/" + item.asset + "/original" : "/api/assets/" + item.asset + "/thumbnail?size=preview";
  var src = path.join(tmp, "face.src"), out = path.join(tmp, "face.jpg");
  this.refreshing = this.immich("GET", url, null, true).then(function (img) {
    fs.writeFileSync(src, img.buf);
    return self.resizeBatch([{ in: src, out: out, crop: squareCrop(item.box, "face"), size: 512, quality: 82, orient: useOriginal }]);
  }).then(function () {
    var name = "";
    if (fs.existsSync(out) && fs.statSync(out).size) {
      var buf = fs.readFileSync(out);
      name = person.id + "-" + crypto.createHash("sha1").update(buf).digest("hex").slice(0, 12) + ".jpg";
      fs.writeFileSync(path.join(self.dir, name), buf);
    } else {
      name = item.file;
    }
    self.patchConfig(function (raw) { raw.faceAssets = raw.faceAssets && typeof raw.faceAssets === "object" ? raw.faceAssets : {}; raw.faceAssets[person.name] = item.asset; });
    person.face = name;
    person.faceAsset = item.asset;
    self.saveIndex();
    self.unlinkIfUnused(oldFace);
    return self.manifest();
  }).then(function (m) {
    fs.rmSync(tmp, { recursive: true, force: true });
    self.refreshing = null;
    return m;
  }, function (e) {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (x) {}
    self.refreshing = null;
    throw e;
  });
  return this.refreshing;
};

// ---- Parent approval (v30) -------------------------------------------------------------
// photo-approved.json: people {name: [asset]} = playable; by {asset: "bot"|"parent"};
// pending [{asset, person, file, box, mime, when, day, faces, hash, addedAt}] = waiting for the
// parent's OK. Pending photos are never in the manifest, so no device can deal them.
PhotoStore.prototype.pendingPath = function (name) {
  if (!FILE_RE.test(String(name || ""))) return null;
  var p = path.join(this.pendingDir, name);
  return fs.existsSync(p) ? p : null;
};

PhotoStore.prototype.review = function () {
  var appr = this.readApproved() || { people: {}, by: {}, pending: [] };
  var by = appr.by || {};
  var live = [];
  (this.index.people || []).forEach(function (p) {
    (p.items || []).forEach(function (it) {
      live.push({ person: p.name, personId: p.id, file: it.file, asset: it.asset, by: by[it.asset] === "parent" ? "parent" : "bot", face: false });
    });
  });
  var pending = (appr.pending || []).filter(function (x) { return x && x.file; }).map(function (x) {
    return { person: x.person, file: x.file, asset: x.asset, day: x.day || "", addedAt: x.addedAt || 0 };
  });
  return { ok: true, pending: pending, live: live, pendingCount: pending.length };
};

PhotoStore.prototype.pendingCount = function () {
  var appr = this.readApproved();
  return appr && Array.isArray(appr.pending) ? appr.pending.length : 0;
};

function busyErr() { return Object.assign(new Error("Photos are refreshing. Try again in a minute."), { code: 409 }); }

// Parent approves pending photos: they join the game for every device on the next sync.
PhotoStore.prototype.approvePending = function (assets) {
  if (this.refreshing) return Promise.reject(busyErr());
  var self = this;
  var want = {};
  (assets || []).forEach(function (a) { want[String(a)] = true; });
  var moved = 0;
  var appr = this.readApproved();
  if (!appr) return Promise.reject(Object.assign(new Error("No approval list on the home computer."), { code: 404 }));
  var keep = [];
  appr.by = appr.by || {};
  (appr.pending || []).forEach(function (x) {
    if (!want[x.asset]) { keep.push(x); return; }
    var person = (self.index.people || []).filter(function (p) { return p.name === x.person; })[0];
    var src = self.pendingPath(x.file);
    if (!person || !src) { keep.push(x); return; }
    fs.renameSync(src, path.join(self.dir, x.file));
    person.photos = person.photos || [];
    person.items = person.items || [];
    if (person.photos.indexOf(x.file) === -1) {
      person.photos.push(x.file);
      person.items.push({ file: x.file, asset: x.asset, box: x.box, mime: x.mime || "", when: x.when || 0, day: x.day || "", faces: x.faces || 0, hash: x.hash || "" });
    }
    if (!person.face) { person.face = x.file; }
    appr.people[x.person] = appr.people[x.person] || [];
    if (appr.people[x.person].indexOf(x.asset) === -1) appr.people[x.person].push(x.asset);
    appr.by[x.asset] = "parent";
    moved += 1;
  });
  appr.pending = keep;
  fs.writeFileSync(this.approvedFile + ".tmp", JSON.stringify(appr, null, 2));
  fs.renameSync(this.approvedFile + ".tmp", this.approvedFile);
  this.saveIndex();
  return Promise.resolve({ ok: true, approved: moved, pendingCount: keep.length });
};

// Parent rejects pending photos: never used (skipAssets), cached preview removed. Immich untouched.
PhotoStore.prototype.rejectPending = function (assets) {
  if (this.refreshing) return Promise.reject(busyErr());
  var self = this;
  var want = {};
  (assets || []).forEach(function (a) { want[String(a)] = true; });
  var appr = this.readApproved();
  if (!appr) return Promise.reject(Object.assign(new Error("No approval list on the home computer."), { code: 404 }));
  var gone = [];
  appr.pending = (appr.pending || []).filter(function (x) {
    if (!want[x.asset]) return true;
    gone.push(x);
    return false;
  });
  fs.writeFileSync(this.approvedFile + ".tmp", JSON.stringify(appr, null, 2));
  fs.renameSync(this.approvedFile + ".tmp", this.approvedFile);
  this.patchConfig(function (raw) {
    raw.skipAssets = Array.isArray(raw.skipAssets) ? raw.skipAssets : [];
    gone.forEach(function (x) { if (raw.skipAssets.indexOf(x.asset) === -1) raw.skipAssets.push(x.asset); });
  });
  gone.forEach(function (x) { var f = self.pendingPath(x.file); if (f) { try { fs.unlinkSync(f); } catch (e) {} } });
  return Promise.resolve({ ok: true, rejected: gone.length, pendingCount: (appr.pending || []).length });
};

// Parent confirms live photos the bot pre-approved ("Looks good").
PhotoStore.prototype.keepLive = function (assets) {
  var appr = this.readApproved();
  if (!appr) return Promise.reject(Object.assign(new Error("No approval list on the home computer."), { code: 404 }));
  appr.by = appr.by || {};
  var n = 0;
  (assets || []).forEach(function (a) { a = String(a); if (appr.by[a] !== "parent") { appr.by[a] = "parent"; n += 1; } });
  fs.writeFileSync(this.approvedFile + ".tmp", JSON.stringify(appr, null, 2));
  fs.renameSync(this.approvedFile + ".tmp", this.approvedFile);
  return Promise.resolve({ ok: true, marked: n });
};

// Queue photos for the parent's OK after the bot's safety review (used by the review tool).
// Read-only on Immich: downloads a preview and makes the same crop the game uses.
PhotoStore.prototype.addPending = function (personName, personImmichId, assetIds) {
  var self = this;
  var cfg = this.readConfig();
  var skip = {};
  cfg.skipAssets.forEach(function (id) { skip[id] = true; });
  var appr = this.readApproved();
  if (!appr) return Promise.reject(new Error("photo-approved.json missing"));
  appr.pending = appr.pending || [];
  var have = {};
  (appr.people[personName] || []).forEach(function (a) { have[a] = true; });
  appr.pending.forEach(function (x) { if (x.person === personName) have[x.asset] = true; });
  var slug = ((this.index.people || []).filter(function (p) { return p.name === personName; })[0] || {}).id || slugify(personName);
  fs.mkdirSync(this.pendingDir, { recursive: true });
  var tmp = path.join(this.pendingDir, "_tmp");
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.mkdirSync(tmp, { recursive: true });
  var ids = (assetIds || []).filter(function (id) { return !skip[id] && !have[id]; });
  return this.approvedItems(personImmichId, ids, 1000, skip).then(function (picked) {
    var jobs = [];
    var chain = Promise.resolve();
    picked.items.forEach(function (it, i) {
      chain = chain.then(function () {
        var orig = smallFace(it.box) && /^image\/(jpeg|png)$/i.test(it.mime || "");
        return self.immich("GET", orig ? "/api/assets/" + it.id + "/original" : "/api/assets/" + it.id + "/thumbnail?size=preview", null, true).then(function (img) {
          var src = path.join(tmp, i + ".src");
          fs.writeFileSync(src, img.buf);
          it.out = path.join(tmp, i + ".jpg");
          jobs.push({ in: src, out: it.out, crop: squareCrop(it.box, "photo"), size: 512, quality: 80, orient: orig });
        }).catch(function () {});
      });
    });
    return chain.then(function () { return self.resizeBatch(jobs); }).then(function () {
      var added = [];
      picked.items.forEach(function (it) {
        if (!it.out || !fs.existsSync(it.out)) return;
        var buf = fs.readFileSync(it.out);
        var name = slug + "-" + crypto.createHash("sha1").update(buf).digest("hex").slice(0, 12) + ".jpg";
        fs.writeFileSync(path.join(self.pendingDir, name), buf);
        added.push({ asset: it.id, person: personName, file: name, box: it.box, mime: it.mime || "", when: it.when || 0, day: dayKey(it.localDate || it.when), faces: it.faces || 0, addedAt: Date.now() });
      });
      return self.hashFiles(added.map(function (a) { return path.join(self.pendingDir, a.file); })).then(function (h) {
        added.forEach(function (a) { a.hash = h[path.join(self.pendingDir, a.file)] || ""; });
        var fresh = self.readApproved();
        fresh.pending = (fresh.pending || []).concat(added);
        fs.writeFileSync(self.approvedFile + ".tmp", JSON.stringify(fresh, null, 2));
        fs.renameSync(self.approvedFile + ".tmp", self.approvedFile);
        fs.rmSync(tmp, { recursive: true, force: true });
        return added.length;
      });
    });
  });
};

PhotoStore.prototype.startSchedule = function () {
  var self = this;
  function tick() {
    var cfg = self.readConfig();
    var age = Date.now() - (self.index.refreshedAt || 0);
    // v30: older caches lack per-photo face counts (needed for the photo Name Game), so refresh once.
    var old = (self.index.people || []).some(function (p) { return !Array.isArray(p.items) || p.items.some(function (it) { return it.faces == null; }); });
    if (old || age > cfg.refreshHours * 3600 * 1000) {
      try { self.refresh("schedule"); } catch (e) { console.error("Photo refresh failed:", e && e.message); }
    }
  }
  setTimeout(tick, 20 * 1000).unref();
  setInterval(tick, 60 * 60 * 1000).unref();
};

// Build game items from the reviewed asset list (in order). Read-only Immich calls.
PhotoStore.prototype.approvedItems = function (personId, ids, n, skip) {
  var self = this;
  var items = [];
  var chain = Promise.resolve();
  ids.filter(function (id) { return !skip[id]; }).slice(0, n).forEach(function (id) {
    chain = chain.then(function () {
      return self.immich("GET", "/api/assets/" + id).then(function (a) {
        if (!a || a.type !== "IMAGE" || a.isTrashed || a.isArchived || a.isOffline) return;
        if (a.visibility && a.visibility !== "timeline") return;
        return self.immich("GET", "/api/faces?id=" + id).then(function (faces) {
          var st = faceStats(faces, personId);
          if (!st.mine) return;
          items.push({ id: id, mime: a.originalMimeType || "", when: Date.parse(a.localDateTime || a.fileCreatedAt || 0) || 0, localDate: a.localDateTime || a.fileCreatedAt || "", box: st.mine.box, faces: st.count });
        });
      }).catch(function () {});
    });
  });
  return chain.then(function () {
    return self.immich("GET", "/api/people/" + personId + "/statistics").then(function (st) { return st && st.assets || 0; }).catch(function () { return 0; });
  }).then(function (total) { return { total: total, items: items }; });
};

function dayKey(v) {
  if (!v) return "";
  if (typeof v === "number") return new Date(v).toISOString().slice(0, 10);
  return String(v).slice(0, 10);
}

function hamming(a, b) {
  if (!a || !b || a.length !== b.length) return 64;
  var d = 0;
  for (var i = 0; i < a.length; i++) {
    var x = parseInt(a[i], 16) ^ parseInt(b[i], 16);
    while (x) { d += x & 1; x >>= 1; }
  }
  return d;
}

var NEAR_HASH = 12;      // dHash bits: at or under this = near-identical picture
var MIN_GAP_MS = 6 * 3600 * 1000;

// Best-scoring first, but at most one per calendar day and never within 6 hours of another pick.
function diversePick(scored, n, taken) {
  var list = scored.slice().sort(function (x, y) { return y.score - x.score; });
  var days = {};
  var chosen = [];
  (taken || []).forEach(function (t) { if (t.day) days[t.day] = true; });
  list.forEach(function (s) {
    if (chosen.length >= n) return;
    var d = dayKey(s.localDate || s.when);
    if (d && days[d]) return;
    var near = chosen.concat(taken || []).some(function (c) { return c.when && s.when && Math.abs(c.when - s.when) < MIN_GAP_MS; });
    if (near) return;
    if (d) days[d] = true;
    chosen.push(s);
  });
  return chosen;
}

// Group photos that look alike: the same Immich asset (even for two people), the same
// person on the same day, or near-identical pictures by perceptual hash. Each file gets a
// "look" id; the game never deals two cards with the same look unless they're the pair.
function computeLooks(people) {
  var nodes = [];
  people.forEach(function (p) {
    (p.items || []).forEach(function (it) { nodes.push({ person: p.id, file: it.file, asset: it.asset, day: it.day || "", hash: it.hash || "" }); });
  });
  var parent = nodes.map(function (_, i) { return i; });
  function find(i) { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; }
  function join(a, b) { a = find(a); b = find(b); if (a !== b) parent[b] = a; }
  for (var i = 0; i < nodes.length; i++) {
    for (var j = i + 1; j < nodes.length; j++) {
      var a = nodes[i], b = nodes[j];
      if ((a.asset && a.asset === b.asset) ||
          (a.person === b.person && a.day && a.day === b.day) ||
          hamming(a.hash, b.hash) <= NEAR_HASH) join(i, j);
    }
  }
  var ids = {};
  var n = 0;
  people.forEach(function (p) { p.looks = {}; });
  var byPerson = {};
  people.forEach(function (p) { byPerson[p.id] = p; });
  nodes.forEach(function (nd, i) {
    var r = find(i);
    if (!ids[r]) ids[r] = "l" + (++n);
    byPerson[nd.person].looks[nd.file] = ids[r];
  });
  people.forEach(function (p) {
    if (p.face && p.faceAsset) {
      var src = (p.items || []).filter(function (it) { return it.asset === p.faceAsset; })[0];
      if (src && p.looks[src.file]) p.looks[p.face] = p.looks[src.file];
    }
  });
}

module.exports = { PhotoStore: PhotoStore, squareCrop: squareCrop, smallFace: smallFace, faceStats: faceStats, dayKey: dayKey, hamming: hamming, diversePick: diversePick, computeLooks: computeLooks, NEAR_HASH: NEAR_HASH };
