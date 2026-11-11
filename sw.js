/* Theo's Car Match service worker — cache-first so the game opens offline
   even when the home computer is unreachable (mobile data). Never caches /api. */
var CACHE = "theo-car-match-v35";
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
