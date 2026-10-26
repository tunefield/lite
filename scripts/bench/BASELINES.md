# Key-detection baselines

Every accuracy claim Tunefield makes about key detection was produced by
`scripts/bench/keybench.py`. This file is the record, so the numbers can be re-derived
rather than taken on trust.

    python3 scripts/bench/keybench.py library      # the local smoke test — no download
    python3 scripts/bench/keybench.py giantsteps   # the acceptance test — needs the dataset

**Scoring** is MIREX-weighted: 1.0 exact, 0.5 perfect fifth, 0.3 relative major/minor,
0.2 parallel major/minor, else 0. Report the weighted mean AND the exact-match rate;
the weighted score alone hides a detector that is confidently a fifth out.

## Results — 2026-08-26/27, 30 s window

| set | configuration | MIREX | exact | n |
|---|---|---|---|---|
| library | hpss + Krumhansl-Schmuckler (shipped through beta5) | 48.8 | 42.6 % | 115 |
| library | hpss + **edma** (ships in beta6) | 52.7 | 47.8 % | 115 |
| GiantSteps+ | hpss + Krumhansl-Schmuckler | 58.0 | 48.2 % | 220 |
| GiantSteps+ | hpss + **edma** | **61.0** | **51.4 %** | 220 |
| GiantSteps+ | full run, before → after | 58.5 → 59.9 | 49.0 → 49.2 % | 478 |

So the profile swap is worth **+3.0 MIREX on GiantSteps and +3.9 on the library's own
tags**, holding everything else constant. That is well short of the ~15 points the
published table predicts, because our incumbent already scored far above the published
Krumhansl baseline — there was less headroom than the literature implied.

## Changes that were measured and NOT shipped

Recorded because a future session will otherwise re-propose them:

| change | library | GiantSteps | verdict |
|---|---|---|---|
| chroma off HPSS (raw signal) | +2.1 | −0.3 | flips sign — sample noise, dropped |
| applying the tuning offset to chroma | +0.4 | −0.3 | a wash, dropped |

## Whole-track key — 2026-08-27, SHIPPED in features_version 4

Reading the key from the entire track instead of the scan window, streamed at 11,025 Hz
so it costs ~1.1 s and 283 MB rather than the ~1.2 GB an unstreamed decode would take.
Unlike the two changes above, this **replicated on both sets**:

| set | window (fv3) | whole-track (fv4) | delta | n |
|---|---|---|---|---|
| library | 52.7 (47.8 % exact) | **59.3** (53.0 %) | **+6.6** | 115 |
| GiantSteps+ | 61.5 (52.0 % exact) | **70.4** (61.5 %) | **+8.9** | 200 |

Worth more than every other key change combined — 70.4 approaches madmom's CNN (74.6
weighted) using nothing but published constants and a streamed read. `harmony.key_scope`
records `whole` or `window` per track, so a build where soundfile/scipy went missing is
visible in the data rather than silently less accurate.

Tuning is still *measured and stored* (`tuning_cents`, `tuning_valid`); it is simply not
applied to the chroma the key is read from.

## Coverage vs cost — 2026-08-27, n = 60

| coverage | MIREX | exact | sec/track |
|---|---|---|---|
| legacy 30 s | 46.8 | 41.7 % | 1.04 |
| 10 % | 47.3 | 40.0 % | 1.42 |
| 25 % | 49.3 | 41.7 % | 3.44 |
| 50 % | 47.7 | 40.0 % | 6.94 |
| 100 % | **51.8** | **45.0 %** | 14.38 |

Note 50 % scores *below* 25 %: at n = 60 the differences between 10/25/50 are inside the
noise band (roughly ±5 points). Only 100 % is clearly ahead. Do not rank the middle
options from this table — it would need n ≈ 300 to mean anything.

## Ground truth

`library` scores against each file's own ID3 key tag, which is why the tag audit in
`load_library()` matters: 19 FMA files carry a bare `"C"` with no mode and score 16.8.
They are defaults, not data, and are excluded. Tags are themselves ~5–10 % wrong
(Schreiber et al., TISMIR 2020), so treat the library number as a floor.

`giantsteps` needs the GiantSteps+ EDM Key dataset (Zenodo record 1095691, CC BY-SA 4.0)
unpacked at `_local/datasets/giantsteps/` as `audio/audio/*.mp3` and `keys/keys_gs+/*.txt`.
Files whose annotation carries two keys (`|`) or "other" are excluded as unscorable.

## Environment

Measured on an M3 Max, librosa 0.11.0, numpy 2.5.2, Python 3.12. Timings are wall-clock
per track, single process. The M2 floor machine has never been measured — that is a
standing gap, not an omission from this file.
