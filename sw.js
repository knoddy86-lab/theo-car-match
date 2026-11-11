/* Theo's Car Match service worker — cache-first so the game opens offline
   even when the home computer is unreachable (mobile data). Never caches /api. */
var CACHE = "theo-car-match-v42";
var CORE = [
  "./",
  "./index.html",
  "./manifest.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/apple-touch-icon.png"
];
var OPTIONAL = [
  "./version.json",
  "./sounds/rosie.mp3",
  "./sounds/tugger.mp3",
  "./sounds/skye.mp3",
  "./sounds/pip.mp3",
  "./sounds/sunny.mp3",
  "./sounds/hank.mp3",
  "./sounds/officer.mp3",
  "./sounds/lets-match.mp3",
  "./sounds/revs/01-idle-blip.mp3",
  "./sounds/revs/02-idle-blip-high.mp3",
  "./sounds/revs/03-double-blip.mp3",
  "./sounds/revs/04-triple-blip.mp3",
  "./sounds/revs/05-long-rev-up.mp3",
  "./sounds/revs/06-rev-up-hold.mp3",
  "./sounds/revs/07-burble-crackle.mp3",
  "./sounds/revs/08-aggressive-short.mp3",
  "./sounds/revs/09-slow-rumble-blip.mp3",
  "./sounds/revs/10-long-crackle-down.mp3",
  "./sounds/revs/11-two-step.mp3",
  "./sounds/revs/12-gentle-blip.mp3",
  "./sounds/hooray/01-girl-woohoo.mp3",
  "./sounds/hooray/02-yay.mp3",
  "./sounds/hooray/03-joyful-yay.mp3",
  "./sounds/hooray/04-celebration-yay.mp3",
  "./sounds/hooray/05-hooray.mp3",
  "./sounds/fart/01-short.mp3",
  "./sounds/fart/02-fluffy.mp3",
  "./sounds/fart/03-squeaky.mp3"
];
// v36: Build a car voice clips (natural voice, see sounds/build/NOTES.md), cached for offline play.
var BUILD_VOICE = ["sh-intro", "sh-try", "sh-done", "sh-more", "sh-find", "dg-parts", "dg-extras", "dg-extra", "p-body", "p-roof", "p-top", "v-rubbish", "x-bin", "x-amber", "x-recycle", "x-arm", "x-bags", "built-red-rubbish", "s-theo-red-rubbish", "s-harper-red-rubbish", "built-blue-rubbish", "s-theo-blue-rubbish", "s-harper-blue-rubbish", "built-yellow-rubbish", "s-theo-yellow-rubbish", "s-harper-yellow-rubbish", "built-green-rubbish", "s-theo-green-rubbish", "s-harper-green-rubbish", "built-orange-rubbish", "s-theo-orange-rubbish", "s-harper-orange-rubbish", "built-purple-rubbish", "s-theo-purple-rubbish", "s-harper-purple-rubbish", 
  "what-build", "road", "construction", "pick-colour", "add-wheels", "add-tracks", "add-roller",
  "pick-extras", "pick-extra", "ready-go", "vroom", "beep-beep", "great-building", "n-1", "n-2", "n-3",
  "n-4", "n-5", "n-6", "c-red", "c-blue", "c-yellow", "c-green", "c-orange", "c-purple", "v-car", "v-ute",
  "v-truck", "v-bus", "v-fire", "v-excavator", "v-dump", "v-roller", "v-backhoe", "v-forklift", "v-loader",
  "x-spoiler", "x-lights", "x-worklights", "x-siren", "x-beacon", "x-ladder", "x-roofbox", "x-surfboard",
  "x-stripes", "x-stripes-plain", "x-flames", "x-stars", "x-plate", "x-sign", "x-dog", "x-flag",
  "x-bikerack", "x-towbar", "x-bullbar", "x-spotlights", "x-snorkel", "x-mudflaps", "x-hosereel", "x-cannon",
  "x-cones", "x-dirt", "x-bigbucket", "x-claw", "x-breaker", "x-pallet", "name-theo", "g-theo",
  "name-harper", "g-harper", "name-jayden", "g-jayden", "built-red-car", "s-theo-red-car",
  "s-harper-red-car", "built-red-ute", "s-theo-red-ute", "s-harper-red-ute", "built-red-truck",
  "s-theo-red-truck", "s-harper-red-truck", "built-red-bus", "s-theo-red-bus", "s-harper-red-bus",
  "built-red-fire", "s-theo-red-fire", "s-harper-red-fire", "built-red-excavator", "s-theo-red-excavator",
  "s-harper-red-excavator", "built-red-dump", "s-theo-red-dump", "s-harper-red-dump", "built-red-roller",
  "s-theo-red-roller", "s-harper-red-roller", "built-red-backhoe", "s-theo-red-backhoe",
  "s-harper-red-backhoe", "built-red-forklift", "s-theo-red-forklift", "s-harper-red-forklift",
  "built-red-loader", "s-theo-red-loader", "s-harper-red-loader", "built-blue-car", "s-theo-blue-car",
  "s-harper-blue-car", "built-blue-ute", "s-theo-blue-ute", "s-harper-blue-ute", "built-blue-truck",
  "s-theo-blue-truck", "s-harper-blue-truck", "built-blue-bus", "s-theo-blue-bus", "s-harper-blue-bus",
  "built-blue-fire", "s-theo-blue-fire", "s-harper-blue-fire", "built-blue-excavator",
  "s-theo-blue-excavator", "s-harper-blue-excavator", "built-blue-dump", "s-theo-blue-dump",
  "s-harper-blue-dump", "built-blue-roller", "s-theo-blue-roller", "s-harper-blue-roller",
  "built-blue-backhoe", "s-theo-blue-backhoe", "s-harper-blue-backhoe", "built-blue-forklift",
  "s-theo-blue-forklift", "s-harper-blue-forklift", "built-blue-loader", "s-theo-blue-loader",
  "s-harper-blue-loader", "built-yellow-car", "s-theo-yellow-car", "s-harper-yellow-car", "built-yellow-ute",
  "s-theo-yellow-ute", "s-harper-yellow-ute", "built-yellow-truck", "s-theo-yellow-truck",
  "s-harper-yellow-truck", "built-yellow-bus", "s-theo-yellow-bus", "s-harper-yellow-bus",
  "built-yellow-fire", "s-theo-yellow-fire", "s-harper-yellow-fire", "built-yellow-excavator",
  "s-theo-yellow-excavator", "s-harper-yellow-excavator", "built-yellow-dump", "s-theo-yellow-dump",
  "s-harper-yellow-dump", "built-yellow-roller", "s-theo-yellow-roller", "s-harper-yellow-roller",
  "built-yellow-backhoe", "s-theo-yellow-backhoe", "s-harper-yellow-backhoe", "built-yellow-forklift",
  "s-theo-yellow-forklift", "s-harper-yellow-forklift", "built-yellow-loader", "s-theo-yellow-loader",
  "s-harper-yellow-loader", "built-green-car", "s-theo-green-car", "s-harper-green-car", "built-green-ute",
  "s-theo-green-ute", "s-harper-green-ute", "built-green-truck", "s-theo-green-truck",
  "s-harper-green-truck", "built-green-bus", "s-theo-green-bus", "s-harper-green-bus", "built-green-fire",
  "s-theo-green-fire", "s-harper-green-fire", "built-green-excavator", "s-theo-green-excavator",
  "s-harper-green-excavator", "built-green-dump", "s-theo-green-dump", "s-harper-green-dump",
  "built-green-roller", "s-theo-green-roller", "s-harper-green-roller", "built-green-backhoe",
  "s-theo-green-backhoe", "s-harper-green-backhoe", "built-green-forklift", "s-theo-green-forklift",
  "s-harper-green-forklift", "built-green-loader", "s-theo-green-loader", "s-harper-green-loader",
  "built-orange-car", "s-theo-orange-car", "s-harper-orange-car", "built-orange-ute", "s-theo-orange-ute",
  "s-harper-orange-ute", "built-orange-truck", "s-theo-orange-truck", "s-harper-orange-truck",
  "built-orange-bus", "s-theo-orange-bus", "s-harper-orange-bus", "built-orange-fire", "s-theo-orange-fire",
  "s-harper-orange-fire", "built-orange-excavator", "s-theo-orange-excavator", "s-harper-orange-excavator",
  "built-orange-dump", "s-theo-orange-dump", "s-harper-orange-dump", "built-orange-roller",
  "s-theo-orange-roller", "s-harper-orange-roller", "built-orange-backhoe", "s-theo-orange-backhoe",
  "s-harper-orange-backhoe", "built-orange-forklift", "s-theo-orange-forklift", "s-harper-orange-forklift",
  "built-orange-loader", "s-theo-orange-loader", "s-harper-orange-loader", "built-purple-car",
  "s-theo-purple-car", "s-harper-purple-car", "built-purple-ute", "s-theo-purple-ute", "s-harper-purple-ute",
  "built-purple-truck", "s-theo-purple-truck", "s-harper-purple-truck", "built-purple-bus",
  "s-theo-purple-bus", "s-harper-purple-bus", "built-purple-fire", "s-theo-purple-fire",
  "s-harper-purple-fire", "built-purple-excavator", "s-theo-purple-excavator", "s-harper-purple-excavator",
  "built-purple-dump", "s-theo-purple-dump", "s-harper-purple-dump", "built-purple-roller",
  "s-theo-purple-roller", "s-harper-purple-roller", "built-purple-backhoe", "s-theo-purple-backhoe",
  "s-harper-purple-backhoe", "built-purple-forklift", "s-theo-purple-forklift", "s-harper-purple-forklift",
  "built-purple-loader", "s-theo-purple-loader", "s-harper-purple-loader"
];
OPTIONAL = OPTIONAL.concat(BUILD_VOICE.map(function (k) { return "./sounds/build/" + k + ".mp3"; }));
// v37: the rest of the game speaks with the same natural voice clips (see sounds/voice/NOTES.md), cached for offline play.
var GAME_VOICE = ["uncle-ashley", "aunty-ashleigh", "wheres-uncle-ashley", "wheres-aunty-ashleigh", 
  "ashleigh", "ashley", "berry", "caitlyn", "cars-or-photos", "cruise", "dart", "delilah", "do", "doc", "dot",
  "fillmore", "flo", "francesco", "grandad", "guido", "gwee-doh", "hank", "harper", "hello", "hello-ashleigh",
  "hello-ashley", "hello-caitlyn", "hello-delilah", "hello-grandad", "hello-harper", "hello-jason",
  "hello-jay-den", "hello-josh", "hello-kelly", "hello-lindsay", "hello-marissa", "hello-mitch", "hello-nanna",
  "hello-theo", "inside", "jason", "jay-den", "josh", "kelly", "laney", "lets-match-the-cars",
  "lets-match-the-family", "lightning", "lightning-mcqueen", "lindsay", "luigi", "mack", "marissa", "mater",
  "mcqueen", "mitch", "moss", "nanna", "nick", "officer", "officer-dot", "pip", "racer", "ramone", "rosie",
  "rosie-racer", "ryan", "sal", "sally", "sarge", "sheriff", "shields", "skye", "sunny", "theo", "tugger",
  "wheres", "wheres-ashleigh", "wheres-ashley", "wheres-caitlyn", "wheres-delilah", "wheres-grandad",
  "wheres-harper", "wheres-jason", "wheres-jay-den", "wheres-josh", "wheres-kelly", "wheres-lindsay",
  "wheres-marissa", "wheres-mitch", "wheres-nanna", "wheres-theo"
];
OPTIONAL = OPTIONAL.concat(GAME_VOICE.map(function (k) { return "./sounds/voice/" + k + ".mp3"; }));
OPTIONAL = OPTIONAL.concat(["uncle-ashley", "aunty-ashleigh", "wheres-uncle-ashley", "wheres-aunty-ashleigh"].map(function (k) { return "./sounds/classic/" + k + ".mp3"; }));

function addBestEffort(cache, urls) {
  return Promise.all(urls.map(function (u) {
    return cache.add(u).then(function () { return true; }, function () { return false; });
  }));
}

function shellReady(cache) {
  var opts = { ignoreSearch: true };
  return cache.match("./index.html", opts).then(function (hit) {
    return hit || cache.match("index.html", opts);
  }).then(function (hit) {
    return hit || cache.match("./", opts);
  }).then(function (hit) {
    return hit || cache.match("/", opts);
  });
}

self.addEventListener("install", function (event) {
  event.waitUntil(
    caches.open(CACHE).then(function (cache) {
      return addBestEffort(cache, CORE).then(function () {
        return shellReady(cache).then(function (shell) {
          if (!shell) return cache.addAll(CORE);
        });
      }).then(function () {
        return addBestEffort(cache, OPTIONAL);
      });
    }).then(function () {
      return self.skipWaiting();
    })
  );
});

self.addEventListener("message", function (event) {
  if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches.open(CACHE).then(function (cache) {
      return shellReady(cache).then(function (shell) {
        if (!shell) return;
        return caches.keys().then(function (keys) {
          return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) {
            return caches.delete(k);
          }));
        });
      });
    }).then(function () { return self.clients.claim(); })
  );
});

function isApiOrSetup(url) {
  var path = url.pathname || "";
  if (path.indexOf("/api/") !== -1 || path === "/api") return true;
  if (path === "/ca" || path.indexOf("/ca.") === 0 || path === "/setup" || path === "/admin") return true;
  if (path.slice(-13) === "/version.json" || path === "/version.json") return true;
  if (path === "/sw.js" || path.slice(-6) === "/sw.js") return true;
  return false;
}

function isNavigation(req, url) {
  if (req.mode === "navigate") return true;
  if (req.destination === "document") return true;
  var path = (url.pathname || "/").replace(/\/+$/, "") || "/";
  var accept = "";
  try { accept = req.headers.get("accept") || ""; } catch (e) {}
  if (accept.indexOf("text/html") !== -1 && (path === "/" || path.slice(-11) === "/index.html" || path === "")) return true;
  return false;
}

function matchShell() {
  var opts = { ignoreSearch: true };
  var base = self.registration && self.registration.scope ? self.registration.scope : self.location.origin + "/";
  var candidates = [
    "./index.html",
    "index.html",
    "./",
    "/",
    new URL("./index.html", base).href,
    new URL("./", base).href,
    new URL("index.html", base).href
  ];
  return caches.keys().then(function (keys) {
    var ordered = keys.filter(function (k) { return k === CACHE; }).concat(keys.filter(function (k) { return k !== CACHE; }));
    function nextCache(i) {
      if (i >= ordered.length) return Promise.resolve(null);
      return caches.open(ordered[i]).then(function (cache) {
        return nextUrl(cache, 0);
      }).then(function (hit) {
        return hit || nextCache(i + 1);
      });
    }
    function nextUrl(cache, j) {
      if (j >= candidates.length) return Promise.resolve(null);
      return cache.match(candidates[j], opts).then(function (hit) {
        return hit || nextUrl(cache, j + 1);
      });
    }
    return nextCache(0);
  });
}

function fetchWithTimeout(req, ms) {
  if (typeof AbortController === "undefined") return fetch(req);
  var ctrl = new AbortController();
  var timer = setTimeout(function () { try { ctrl.abort(); } catch (e) {} }, ms || 3000);
  return fetch(req, { signal: ctrl.signal, credentials: "same-origin" }).then(function (res) {
    clearTimeout(timer);
    return res;
  }, function (err) {
    clearTimeout(timer);
    throw err;
  });
}

function putInCache(req, res) {
  if (!res || !res.ok) return;
  var copy = res.clone();
  caches.open(CACHE).then(function (cache) { cache.put(req, copy); }).catch(function () {});
}

self.addEventListener("fetch", function (event) {
  var req = event.request;
  if (req.method !== "GET") return;
  var url;
  try { url = new URL(req.url); } catch (e) { return; }
  if (url.origin !== self.location.origin) return;
  if (isApiOrSetup(url)) return;

  if (isNavigation(req, url)) {
    event.respondWith(
      fetchWithTimeout(req, 3000).then(function (res) {
        if (res && res.ok) {
          putInCache(req, res);
          putInCache("./index.html", res);
          return res;
        }
        return matchShell().then(function (hit) { return hit || res; });
      }).catch(function () {
        return matchShell().then(function (hit) {
          return hit || new Response("Theo's Car Match is offline just now.", { status: 503, statusText: "Offline", headers: { "Content-Type": "text/plain; charset=utf-8" } });
        });
      })
    );
    return;
  }

  event.respondWith(
    caches.match(req, { ignoreSearch: true }).then(function (hit) {
      if (hit) {
        fetchWithTimeout(req, 3000).then(function (res) { putInCache(req, res); }).catch(function () {});
        return hit;
      }
      return fetchWithTimeout(req, 3000).then(function (res) {
        putInCache(req, res);
        return res;
      }).catch(function () {
        if (isNavigation(req, url)) return matchShell();
        return new Response("", { status: 503, statusText: "Offline" });
      }).then(function (res) {
        return res || new Response("", { status: 503, statusText: "Offline" });
      });
    })
  );
});
