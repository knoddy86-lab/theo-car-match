"use strict";

var fs = require("fs");
var path = require("path");
var crypto = require("crypto");

var SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };
var WINDOW_MS = 15 * 60 * 1000;
var MAX_FAILS = 5;

function PinStore(dataDir) {
  this.file = path.join(dataDir, "pin.json");
  this.fails = {}; // ip -> [timestamps]
}

PinStore.prototype.load = function () {
  if (!fs.existsSync(this.file)) return null;
  try { return JSON.parse(fs.readFileSync(this.file, "utf8")); } catch (e) { return null; }
};

PinStore.prototype.hasPin = function () {
  var rec = this.load();
  return !!(rec && rec.hash && rec.salt);
};

PinStore.prototype.setPin = function (pin) {
  pin = String(pin || "");
  if (pin.length < 4) throw Object.assign(new Error("PIN must be at least 4 characters"), { code: 400 });
  var salt = crypto.randomBytes(16);
  var hash = crypto.scryptSync(pin, salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p });
  var rec = {
    algorithm: "scrypt",
    N: SCRYPT.N,
    r: SCRYPT.r,
    p: SCRYPT.p,
    keylen: SCRYPT.keylen,
    salt: salt.toString("hex"),
    hash: hash.toString("hex"),
    updatedAt: Date.now()
  };
  fs.writeFileSync(this.file, JSON.stringify(rec, null, 2) + "\n", { mode: 0o600 });
};

PinStore.prototype.verify = function (pin) {
  var rec = this.load();
  if (!rec || !rec.hash || !rec.salt) return false;
  var salt = Buffer.from(rec.salt, "hex");
  var expected = Buffer.from(rec.hash, "hex");
  var hash = crypto.scryptSync(String(pin || ""), salt, rec.keylen || SCRYPT.keylen, {
    N: rec.N || SCRYPT.N,
    r: rec.r || SCRYPT.r,
    p: rec.p || SCRYPT.p
  });
  if (hash.length !== expected.length) return false;
  return crypto.timingSafeEqual(hash, expected);
};

PinStore.prototype.pruneFails = function (ip) {
  var now = Date.now();
  var list = (this.fails[ip] || []).filter(function (t) { return now - t < WINDOW_MS; });
  this.fails[ip] = list;
  return list;
};

PinStore.prototype.isLimited = function (ip) {
  return this.pruneFails(ip).length >= MAX_FAILS;
};

PinStore.prototype.recordFail = function (ip) {
  var list = this.pruneFails(ip);
  list.push(Date.now());
  this.fails[ip] = list;
  return list.length;
};

PinStore.prototype.clearFails = function (ip) {
  delete this.fails[ip];
};

PinStore.prototype.remaining = function (ip) {
  return Math.max(0, MAX_FAILS - this.pruneFails(ip).length);
};

module.exports = { PinStore: PinStore, MAX_FAILS: MAX_FAILS, WINDOW_MS: WINDOW_MS };
