# Build a car voice clips — voice, licence and how they were made

These clips are what Build a car says (prompts, numbers, colours, vehicle names, extras, "Beep beep!", "Vroom!",
"Great building!", and "<player> built a <colour> <vehicle>!"). They replace the device's text-to-speech voice in Build.
The game falls back to the device voice only when a clip is missing (for example a new player's name).

## Voice

- **Voice:** "Alba" (Scottish English, female), Piper model `en_GB-alba-medium`
  (https://huggingface.co/rhasspy/piper-voices/tree/main/en/en_GB/alba/medium).
- **Engine:** Piper neural text-to-speech (https://github.com/rhasspy/piper, MIT licence), run offline.
- **Training data licence:** the Alba dataset from the University of Edinburgh CSTR
  (https://datashare.ed.ac.uk/handle/10283/3270), **Creative Commons Attribution 4.0 (CC BY 4.0)**,
  which allows redistribution and use with attribution. Attribution: *Voice: "Alba" by the Centre for Speech
  Technology Research, University of Edinburgh (CC BY 4.0), via the Piper en_GB-alba-medium model.*
- Not a celebrity voice and not cloned from anyone; it is a standard open research voice.

There was no en_AU voice in the Piper catalogue. The older car-name clips (`sounds/<car>.mp3`) were made with
Sound of Text (Google's en-AU voice), which has no clear redistribution licence, so it was not used for these clips.

Voices that were tried and not used:
- `en_GB-cori-high` (public domain LibriVox data): words were often unclear (for example "Theo" heard as "See you though").
- `en_GB-jenny_dioco-medium` (Jenny (Dioco) licence, permissive): slightly less clear than Alba.
- `en_US-hfc_female` (non-commercial licence): excluded.

## How they were made

1. Each phrase was rendered with Piper (length scale 1.05–1.2 for short words, 1.0–1.1 for sentences;
   noise scale 0.5–0.6, noise width 0.7).
2. **Check:** every take was transcribed with a speech recogniser (Whisper small.en). If a take wasn't heard
   correctly, up to four takes were made and the best one kept. 269 of 270 matched exactly. The one that didn't was
   "Add the wheels!", heard as "At the wheels".
   "Road!" was always heard as "Rude", so that clip says "Road vehicles!" instead.
3. Silence trimmed from the start (the clips start straight away) and the end. A 30 ms lead-in and 80 ms tail
   were added, loudness normalised to about −17 LUFS, and true peak limited to −2 dBFS (no clipping: the loudest
   clip peaks at −2.0 dBFS).
4. Encoded as mono MP3, 22.05 kHz, 40 kbit/s. 270 files, about 2.1 MB in total; each clip is 0.55–2.4 s long.

Player names go through the game's "say it like" map before rendering (Jayden is rendered as "Jay den").
Full sentences are pre-rendered for Theo and Harper (`s-<player>-<colour>-<vehicle>.mp3`), so they don't sound
choppy. For other players the game says the name (a clip for Jayden, otherwise the device voice) and then plays
`built-<colour>-<vehicle>.mp3`.

## File names

| Pattern | Says |
|---|---|
| `what-build`, `road`, `construction`, `pick-colour`, `add-wheels`, `add-tracks`, `add-roller`, `pick-extras`, `pick-extra`, `ready-go` | Step prompts |
| `n-1` … `n-6` | One … Six |
| `c-<colour>` | Red, Blue, Yellow, Green, Orange, Purple |
| `v-<vehicle>` | Car, Ute, Truck, Bus, Fire truck, Excavator, Dump truck, Steamroller, Backhoe, Forklift, Front loader |
| `x-<extra>` | Extra names (horn uses `beep-beep`) |
| `beep-beep`, `vroom`, `great-building` | Fun words |
| `name-<player>`, `g-<player>` | A player's name, "<player>'s garage!" |
| `s-<player>-<colour>-<vehicle>` | "<Player> built a <colour> <vehicle>!" |
| `built-<colour>-<vehicle>` | "built a <colour> <vehicle>!" (put after a name) |

All of these are listed in `sw.js` (`BUILD_VOICE`) so they are cached for offline play.

v40: added the rubbish truck clips (v-rubbish, x-bin, x-amber "Warning lights!", x-recycle, x-arm, x-bags, built-*-rubbish, s-theo/s-harper-*-rubbish). Same en_GB-alba-medium Piper voice and processing, checked with Whisper.

v42: Shadow game lines: sh-intro "Put each car on its shadow!", sh-try "Try again!", sh-done "You did it!", sh-more "More shadows!", sh-find "Find the shadow!". Same Alba voice and processing, checked with Whisper (5 of 5 exact).

v43: x-exhaust "Exhaust pipe!" (new Exhaust pipe extra). Same Alba voice and processing, checked with Whisper (exact).

v44: n-7 "Seven!", n-8 "Eight!", all-wheels "All the wheels are on!", other-side "And the other side!", and add-roller re-made as "Add the roller and wheels!" (wheels on both sides). Same Alba voice (Piper en_GB-alba-medium, CC BY 4.0) and processing, checked with Whisper (5 of 5 exact).
