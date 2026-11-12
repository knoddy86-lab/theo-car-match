# Game voice clips (v37) — voice, licence and how they were made

Since v37 every spoken line in Theo's Car Match uses the same natural voice as Build a car (`sounds/build/`):
car names when a card flips, the Name game ("Where's Nanna?" for photos, the car's name for cars, in every
Say option: Full, First, Last, Nickname and Mix), family people's names, player names ("Hello Theo!"),
and the start-screen lines ("Cars or photos?", "Let's match the cars!", "Let's match the family!").

The older car-name clips (`sounds/rosie.mp3`, `tugger.mp3`, `skye.mp3`, `pip.mp3`, `sunny.mp3`, `hank.mp3`,
`officer.mp3`, `lets-match.mp3`, `great-job.mp3`) were made with Sound of Text (Google's en-AU voice), which has no
clear redistribution licence. They were taken out in v37 and put back in v39 for the **Classic** voice.

## Which voice plays (v39)

Settings has a per-device voice for each part of the game: **Name game voice**, **Match voice** and
**Build voice**, each Classic or Alba. Defaults: Name game = Classic, Match = Alba, Build = Alba.
Classic is the pre-v37 voice: the Sound of Text clips above, Sound of Text clips fetched online for renamed or
new cards, and the device voice for everything else. Alba uses the clips in this folder (and `sounds/build/`).
The start-screen prompts use Alba.

## Voice and licence

- **Voice:** "Alba" (Scottish English, female), Piper model `en_GB-alba-medium`
  (https://huggingface.co/rhasspy/piper-voices/tree/main/en/en_GB/alba/medium).
- **Engine:** Piper neural text-to-speech (https://github.com/rhasspy/piper, **MIT licence**), run offline.
- **Voice data licence:** the Alba dataset from the University of Edinburgh CSTR
  (https://datashare.ed.ac.uk/handle/10283/3270), **Creative Commons Attribution 4.0 (CC BY 4.0)**.
  Attribution: *Voice: "Alba" by the Centre for Speech Technology Research, University of Edinburgh (CC BY 4.0),
  via the Piper en_GB-alba-medium model.*

## How they were made

Same pipeline as `sounds/build/NOTES.md`: Piper render (length scale 1.05–1.2 for short words, 1.0–1.1 for
sentences; noise 0.5–0.6, noise width 0.7), each take checked with a speech recogniser (Whisper small.en) and up
to four takes kept best, silence trimmed with a 40 ms lead-in and 80 ms tail, loudness normalised to about
−17 LUFS (true peak −2 dBFS), mono MP3 22.05 kHz 40 kbit/s.

Names go through the game's "Say it like" spellings before rendering (Jayden is rendered as "Jay den",
Guido as "Gwee-doh", Sally as "Sal", and so on), because the game looks clips up by the spoken text.

## File names and fallback

A clip's file name is the spoken text in lowercase, apostrophes dropped, other characters turned into `-`
(for example "Where's Jay den?" is `wheres-jay-den.mp3`). The list of clips is in `index.html` (`VOICE_CLIPS`)
and `sw.js` (`GAME_VOICE`, cached for offline play).

If a whole line has no clip, the game tries each sentence, then "Where's" or "Hello" plus a name clip. Only a
part with no clip at all (for example a name typed after this version was made) is said by the device voice.
Family members' own recordings on a card still play first. The offline single HTML file has no clips, so it
uses the device voice.

v41: added uncle-ashley, aunty-ashleigh, wheres-uncle-ashley, wheres-aunty-ashleigh (same Alba voice and processing).

v45: every clip in the app was loudness-matched to about -16 LUFS integrated with true peak at or below -1.5 dBTP (gain plus a gentle peak limiter, re-encoded at the same sample rate and bitrate; content, length and licence unchanged). Before, levels ranged from about -23 to -15 LUFS.

v46: added find, then, whos-missing, look-carefully, super-fast for the Name game harder tricks ("Find X, then Y", Who's missing, mini timer cheer). Same Alba voice (en_GB-alba-medium, CC BY 4.0) and checks, loudness-matched to -16 LUFS / -1.5 dBTP.
