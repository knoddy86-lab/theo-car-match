"use strict";

var fs = require("fs");
var path = require("path");
var os = require("os");
var forge = require("./vendor/node-forge");

var ALWAYS_IPS = ["127.0.0.1", "192.168.68.91"];

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

function currentSans() {
  var ips = {};
  ALWAYS_IPS.concat(lanIPv4()).forEach(function (ip) { if (ip) ips[ip] = true; });
  var hosts = {};
  try {
    var hn = os.hostname();
    if (hn) {
      hosts[hn] = true;
      if (hn.indexOf(".") === -1) hosts[hn + ".local"] = true;
    }
  } catch (e) {}
  return {
    ips: Object.keys(ips).sort(),
    dns: Object.keys(hosts).sort()
  };
}

function sansEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function daysFromNow(days) {
  var d = new Date();
  d.setTime(d.getTime() + days * 24 * 60 * 60 * 1000);
  return d;
}

function makeCa(certsDir) {
  var keys = forge.pki.rsa.generateKeyPair(2048);
  var cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = "01";
  cert.validity.notBefore = new Date();
  cert.validity.notBefore.setDate(cert.validity.notBefore.getDate() - 1);
  cert.validity.notAfter = daysFromNow(3650);
  var attrs = [
    { name: "commonName", value: "Theo's Car Match Home CA" },
    { name: "organizationName", value: "Theo's Car Match" },
    { name: "countryName", value: "AU" }
  ];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.setExtensions([
    { name: "basicConstraints", cA: true, pathLenConstraint: 0 },
    { name: "keyUsage", keyCertSign: true, cRLSign: true, digitalSignature: true },
    { name: "subjectKeyIdentifier" }
  ]);
  cert.sign(keys.privateKey, forge.md.sha256.create());
  var caCertPem = forge.pki.certificateToPem(cert);
  var caKeyPem = forge.pki.privateKeyToPem(keys.privateKey);
  fs.writeFileSync(path.join(certsDir, "ca.crt"), caCertPem, { mode: 0o600 });
  fs.writeFileSync(path.join(certsDir, "ca.key"), caKeyPem, { mode: 0o600 });
  return { cert: cert, key: keys.privateKey, certPem: caCertPem, keyPem: caKeyPem };
}

function loadCa(certsDir) {
  var crtPath = path.join(certsDir, "ca.crt");
  var keyPath = path.join(certsDir, "ca.key");
  if (!fs.existsSync(crtPath) || !fs.existsSync(keyPath)) return makeCa(certsDir);
  try {
    var cert = forge.pki.certificateFromPem(fs.readFileSync(crtPath, "utf8"));
    var key = forge.pki.privateKeyFromPem(fs.readFileSync(keyPath, "utf8"));
    return { cert: cert, key: key, certPem: fs.readFileSync(crtPath, "utf8"), keyPem: fs.readFileSync(keyPath, "utf8") };
  } catch (e) {
    return makeCa(certsDir);
  }
}

function makeServerCert(ca, sans, certsDir) {
  var keys = forge.pki.rsa.generateKeyPair(2048);
  var cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = Date.now().toString(16);
  cert.validity.notBefore = new Date();
  cert.validity.notBefore.setDate(cert.validity.notBefore.getDate() - 1);
  cert.validity.notAfter = daysFromNow(825);
  var attrs = [
    { name: "commonName", value: (sans.dns[0] || "theo-car-match") },
    { name: "organizationName", value: "Theo's Car Match" }
  ];
  cert.setSubject(attrs);
  cert.setIssuer(ca.cert.subject.attributes);
  var alt = [];
  sans.dns.forEach(function (n) { alt.push({ type: 2, value: n }); });
  sans.ips.forEach(function (ip) { alt.push({ type: 7, ip: ip }); });
  cert.setExtensions([
    { name: "basicConstraints", cA: false },
    { name: "keyUsage", digitalSignature: true, keyEncipherment: true },
    { name: "extKeyUsage", serverAuth: true },
    { name: "subjectAltName", altNames: alt }
  ]);
  cert.sign(ca.key, forge.md.sha256.create());
  var certPem = forge.pki.certificateToPem(cert);
  var keyPem = forge.pki.privateKeyToPem(keys.privateKey);
  fs.writeFileSync(path.join(certsDir, "server.crt"), certPem, { mode: 0o600 });
  fs.writeFileSync(path.join(certsDir, "server.key"), keyPem, { mode: 0o600 });
  fs.writeFileSync(path.join(certsDir, "sans.json"), JSON.stringify(sans, null, 2));
  return { certPem: certPem, keyPem: keyPem };
}

function loadSans(certsDir) {
  var p = path.join(certsDir, "sans.json");
  if (!fs.existsSync(p)) return null;
  try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch (e) { return null; }
}

function ensureCerts(dataDir) {
  var certsDir = path.join(dataDir, "certs");
  fs.mkdirSync(certsDir, { recursive: true });
  var ca = loadCa(certsDir);
  var sans = currentSans();
  var existing = loadSans(certsDir);
  var needLeaf = !existing || !sansEqual(existing, sans) ||
    !fs.existsSync(path.join(certsDir, "server.crt")) ||
    !fs.existsSync(path.join(certsDir, "server.key"));
  var leaf;
  var regenerated = false;
  if (needLeaf) {
    leaf = makeServerCert(ca, sans, certsDir);
    regenerated = true;
  } else {
    leaf = {
      certPem: fs.readFileSync(path.join(certsDir, "server.crt"), "utf8"),
      keyPem: fs.readFileSync(path.join(certsDir, "server.key"), "utf8")
    };
  }
  var der = forge.asn1.toDer(forge.pki.certificateToAsn1(ca.cert)).getBytes();
  return {
    caCertPem: ca.certPem,
    caCertDer: Buffer.from(der, "binary"),
    serverCertPem: leaf.certPem,
    serverKeyPem: leaf.keyPem,
    sans: sans,
    regenerated: regenerated,
    certsDir: certsDir
  };
}

module.exports = { ensureCerts: ensureCerts, currentSans: currentSans, lanIPv4: lanIPv4 };
