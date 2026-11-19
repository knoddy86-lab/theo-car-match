# Pages build vs full build (v54)

- **GitHub Pages (this repo)** has no voice clips that say family or relative names. The app and `sw.js` list none of them, so nothing is requested and there is no 404; those names are said by the device voice.
- **Full build** (WIN11A `theo-sync\game`, Desktop `cars game`) = this repo + the family clips + the same two files with `FAMILY_CLIPS` filled in. Make it with `tools/make-full-build.py --family <private folder> --out <stage dir> --zip <zip>`.
- The private folder (`family-clips.json` + `sounds/...`) is never committed. Add new family clips to that folder and to `family-clips.json`, never to this repo. The git history before v54 still contains the old clips (history was not rewritten).
