# Loudness (v51)

Every clip in `sounds/` (voice Alba and Classic, build clips, car names, engine revs, hooray, farts, Numbers yays and farts) is held at the same level: about **-16 LUFS integrated** (measured with ffmpeg ebur128; all clips between -16.5 and -15.8 LUFS, so within +/-0.5 LU) with a **true peak at or below -1.5 dBTP** (nothing clips).

- Clips that were already within +/-0.5 LU were left untouched (no re-encode).
- Outliers were gain-adjusted (and peak-limited where needed) and re-encoded at their existing sample rate, mono and bitrate: all Numbers yays and farts, `fart/01-short`, `fart/02-fluffy`, `build/p-top`, `build/v-truck`, `voice/doc`.
- `fart/01-short` is only 0.41 s (too short for an integrated reading); it was measured by looping it.
- No per-sound or per-game volume multipliers exist in the code (audio elements always play at full volume; the only gain nodes are the WebAudio tone beeps). The Match card-flip tick was raised from 0.05 to 0.35 so it is no longer inaudibly quiet next to the voice clips.
- Not controllable from here: the device voice fallback (speech synthesis) and online name clips (soundoftext), which are only used for renamed or custom names.
