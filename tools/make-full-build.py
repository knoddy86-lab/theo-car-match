#!/usr/bin/env python3
"""Make the FULL build (WIN11A theo-sync\\game and the Desktop copy) from this repo (the GitHub Pages build).

The Pages build has no clips that say family or relative names (rule from v54). The full build is the same files
plus those clips, which live OUTSIDE the repo in a private folder:

    <family-dir>/family-clips.json   {"voice": [...], "classic": [...], "build": [...], "buildNames": [...], "sentence": [...]}
    <family-dir>/sounds/...          the mp3 files, same relative paths as in the repo

Usage: make-full-build.py --family DIR --out STAGE_DIR [--zip STAGE.zip] [--pages-zip PAGES.zip]
Writes index.html, sw.js (family lists filled in), version.json, manifest.json, sounds/ (repo + family) to STAGE_DIR.
Nothing here contains family names; the lists come from family-clips.json.
"""
import argparse, json, os, re, shutil, sys, zipfile

ap = argparse.ArgumentParser()
ap.add_argument("--repo", default=os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
ap.add_argument("--family", required=True)
ap.add_argument("--out", required=True)
ap.add_argument("--zip")
ap.add_argument("--pages-zip", help="also write the plain Pages build (no family clips) as a zip")
a = ap.parse_args()

fam = json.load(open(os.path.join(a.family, "family-clips.json")))
files = ["index.html", "sw.js", "version.json", "manifest.json"]

def fill(text, obj):
    pat = re.compile(r"/\*FAMILY_CLIPS_BEGIN\*/.*?/\*FAMILY_CLIPS_END\*/", re.S)
    if len(pat.findall(text)) != 1: sys.exit("marker not found exactly once")
    return pat.sub(lambda m: "/*FAMILY_CLIPS_BEGIN*/" + json.dumps(obj) + "/*FAMILY_CLIPS_END*/", text)

if os.path.exists(a.out): shutil.rmtree(a.out)
os.makedirs(a.out)
for f in files:
    shutil.copy2(os.path.join(a.repo, f), os.path.join(a.out, f))
shutil.copytree(os.path.join(a.repo, "sounds"), os.path.join(a.out, "sounds"))
n = 0
for sub in ("voice", "classic", "build"):
    for k in fam[sub]:
        src = os.path.join(a.family, "sounds", sub, k + ".mp3")
        if not os.path.exists(src): sys.exit("missing family clip " + src)
        shutil.copy2(src, os.path.join(a.out, "sounds", sub, k + ".mp3")); n += 1
p = os.path.join(a.out, "index.html")
t = open(p).read(); open(p, "w").write(fill(t, {k: fam[k] for k in ("voice", "classic", "buildNames", "sentence")}))
p = os.path.join(a.out, "sw.js")
t = open(p).read(); open(p, "w").write(fill(t, {k: fam[k] for k in ("voice", "classic", "build")}))
print("full build in", a.out, "with", n, "family clips")

def zipdir(root, dest):
    with zipfile.ZipFile(dest, "w", zipfile.ZIP_DEFLATED) as z:
        for f in files: z.write(os.path.join(root, f), f)
        for d, _, fs in os.walk(os.path.join(root, "sounds")):
            for f in fs:
                full = os.path.join(d, f); z.write(full, os.path.relpath(full, root))
if a.zip: zipdir(a.out, a.zip); print("zip", a.zip)
if a.pages_zip: zipdir(a.repo, a.pages_zip); print("pages zip", a.pages_zip)
