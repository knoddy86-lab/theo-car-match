# Letters voice "Emma" (v54)

The 26 letter-name clips `let-a.mp3` to `let-z.mp3` (British English: A, H "aitch", W "double you", Z "zed").

- **Model:** Kokoro-82M v1.0 (hexgrad), **Apache-2.0** licence. https://huggingface.co/hexgrad/Kokoro-82M
- **Voice:** `bf_emma` (British English, female), distributed with the Kokoro model under the same Apache-2.0 licence.
- **Runtime used to render offline:** kokoro-onnx (MIT licence) with the ONNX model files from https://github.com/thewh1teagle/kokoro-onnx/releases (model-files-v1.0). The letter sounds were typed as IPA phonemes (speed 0.9), so no phonemizer ran.
- **Checks:** every letter was transcribed back with Whisper small.en inside the sequence of its two neighbours (26 of 26 read as the right letter; E needed a second check, E E E and B C D E, because the recogniser invents an "L" next to it), durations 0.66 to 1.14 s, pitch about 175-205 Hz with a steady contour.
- **Levelling:** gain and a gentle peak limiter to about -19.2 LUFS integrated, true peak -4.9 dBFS or lower (same target as every other clip); mono MP3 24 kHz 48 kbit/s.
- Credit: *Voice: Kokoro-82M "bf_emma" (Apache-2.0), rendered with kokoro-onnx.*

v60: `let-a.mp3` is the slow Emma take Lindsay picked (Kokoro text "A.", bf_emma, speed 0.8, onset cut past the vowel so there is no leading "an", "they", "the" or "letter"). Same Kokoro-82M bf_emma voice and Apache-2.0 licence. Levelled to -19.2 LUFS integrated, true peak -6.0 dBFS. Mono MP3, 24 kHz, 48 kbit/s. The other candidate takes were not shipped. The other 25 Emma clips were left as they are.
