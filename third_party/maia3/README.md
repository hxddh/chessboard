# Maia-3 (5M)

The human-move model of the 20.0 app (ADR 0004): one network for every
rating from 600 to 2600, the side to move's and the opponent's rating as
continuous inputs, the current position and the seven before it.

> Daniel Monroe, George Eilender, Philip Chalmers, Zhenwei Tang, Ashton Anderson.
> *Chessformer: A Unified Architecture for Chess Modeling.* ICLR 2026.
> arXiv:2605.19091 (CC BY 4.0).

## Where it comes from

| | |
|---|---|
| weights | <https://huggingface.co/UofTCSSLab/Maia3-5M>, file `maia3-5m.pt`, revision `b6559de2398d7140b985f28fd2c19fb5e47ddabe` |
| original file | <https://huggingface.co/UofTCSSLab/Maia3-5M/resolve/b6559de2398d7140b985f28fd2c19fb5e47ddabe/maia3-5m.pt> — 20 968 049 bytes, sha256 `ba14208b2992d85502f5fb501934abf6aaaeb355e9f3fdf90e326911f562524f` |
| code the weights belong to | <https://github.com/CSSLab/maia3> at `1e13597c42d4858b7cfd7cfdae01e297263364b2` (2026-05-25) |
| copyright | the Maia-3 authors, CSSLab, University of Toronto |
| licence | **GNU AGPL v3** (`LICENSE` here: the repository's licence file, verbatim, sha256 `8486a10c…07ef`). The model card says "see repo for code/weights license"; the repository's licence is AGPL-3.0; the 79M card states AGPLv3 outright. |

## NOTICE — this is a modified version

`maia3-5m.f16` and `maia3-5m.json` are **not** the original file. They were
produced on 2026-11-06 by `scripts/gen-maia3.py` (in this repository) from the
original `maia3-5m.pt` above, which is the preferred form for modification
(AGPL-3.0 §1 "Corresponding Source": the original file at the URL above plus
that script). The conversion:

- rounds every float32 to float16 (round to nearest even), little-endian;
- stores every `Linear` weight `[out, in]` transposed as `[in, out]`, and the
  shared geometric-attention-bias table `[4096, 64]` as `[64, 4096]`;
- keeps one copy of that table (the checkpoint carries nine identical copies;
  the script checks they are identical);
- changes nothing else: no pruning, no fine-tuning, no re-ordering of values.

`maia3-5m.json` lists every tensor's name, shape, offset and the original
key it came from. Reproduce with:

```bash
python3 scripts/gen-maia3.py            # downloads the pinned revision, checks its sha256
```

| file | bytes | sha256 |
|---|---|---|
| maia3-5m.f16 | 10 460 224 | 825763fe6ffb784e59ea559668becf02a9dbfaabcb18880ff5e1d4000257e16e |

## How the app uses it, and the licences together

- The forward pass (`src/app/services/maia3/net.js`, `kernels.c`) is this
  app's own code, written from the paper's architecture and the checkpoint's
  shapes, GPL-3.0-or-later like the rest of the app. Its output is checked
  against the original PyTorch code (`scripts/app/maia3-parity.mjs`, 60
  positions).
- GPLv3 §13 and AGPLv3 §13 explicitly allow combining a GPLv3 work with an
  AGPLv3 work and conveying the combination; each part keeps its own licence.
  The AGPL's network clause (§13) concerns users interacting with a modified
  AGPL program over a network; the app runs offline on the user's machine.
- What we ship with it: this file, `LICENSE` (in the installer as
  `licenses/maia3-LICENSE.txt`), and the corresponding source above.
