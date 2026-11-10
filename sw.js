/* Theo's Car Match service worker — caches the game for offline play. Never caches /api. */
var CACHE = "theo-car-match-v10";
var PRECACHE = [
  "./",
  "./index.html",
  "./manifest.json",
  "./version.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/apple-touch-icon.png",
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
  "./sounds/hooray/04-celebration-yay.mp3"
];

self.addEventListener("install", function (event) {
  event.waitUntil(
    caches.open(CACHE).then(function (cache) {
      return cache.addAll(PRECACHE);
    }).then(function () {
      return caches.keys().then(function (keys) {
        var older = keys.some(function (k) { return k !== CACHE; });
        if (!older) return self.skipWaiting();
      });
    })
  );
});

self.addEventListener("message", function (event) {
  if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener("fetch", function (event) {
  var req = event.request;
  if (req.method !== "GET") return;
  var url;
  try { url = new URL(req.url); } catch (e) { return; }
  if (url.origin !== self.location.origin) return;
  if (url.pathname.indexOf("/api/") !== -1 || url.pathname === "/api") return;
  if (url.pathname === "/ca" || url.pathname.indexOf("/ca.") === 0 || url.pathname === "/setup" || url.pathname === "/admin") return;

  event.respondWith(
    fetch(req).then(function (res) {
      if (res && res.ok) {
        var copy = res.clone();
        caches.open(CACHE).then(function (cache) { cache.put(req, copy); });
      }
      return res;
    }).catch(function () {
      return caches.match(req).then(function (hit) {
        if (hit) return hit;
        if (req.mode === "navigate") return caches.match("./index.html");
        return caches.match("./");
      }).then(function (hit) {
        return hit || new Response("Offline", { status: 503, statusText: "Offline" });
      });
    })
  );
});
