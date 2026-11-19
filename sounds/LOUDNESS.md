# Loudness (v53)

Every clip in `sounds/` (voice Alba and Classic, build clips, car names, engine revs, hooray, farts, Numbers yays and farts) sits at the same level: about **-19.2 LUFS integrated** (ffmpeg ebur128; all clips between -19.6 and -18.8 LUFS) with a true peak at or below -4.6 dBFS, so nothing clips.

Why -19: the clips the app can't control sit there. Online name clips (Sound of Text, Google en-AU / en-GB) measured -17.4 to -21.9 LUFS (mean -19.2, 14 samples, no consistent level) and the device speech voice is quiet on iPhone/iPad. Bundled clips used to be -16 (v51), which made them clearly louder than those.

How: v52 lowered every bundled mp3 by exactly 3.0 dB (2 steps of the mp3 global_gain field, the same lossless method as mp3gain: no re-encode, no quality loss). The v51 files are backed up on the build box at `/workspace/audio-backup-v51-sounds`, the v50 originals at `/workspace/audio-backup-v50`.

Code: audio elements never have `.volume` set (iOS ignores it anyway); the device voice utterances now set `volume = 1` explicitly; the Match card-flip tick (WebAudio) gain was lowered from 0.35 to 0.25 to follow the clips.

Not levelled: Sound of Text clips (the file host sends no CORS headers, so WebAudio can't read or measure them), device speech, and any voice recordings made in the app.

v53: the 26 Alba letter clips (build/let-*), the 26 Classic letter clips and 24 Classic Cars-character name clips (classic/) were made at the same level (-19.2 LUFS, peak at or below -4.6 dBFS). Classic names are now bundled and play first; Sound of Text and the device voice remain only as fallbacks for names typed later.

v54: the family-name clips were moved out of the Pages build (full build only); they keep the levels described above.

v54: the 26 Letters "Emma" clips (sounds/letters-emma/) are at the same level (-19.2 LUFS, peak -4.9 dBFS or lower).
