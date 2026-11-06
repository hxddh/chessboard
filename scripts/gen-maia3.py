#!/usr/bin/env python3
"""
Build-time only: convert the released Maia-3 5M checkpoint (PyTorch) into the
two files the app reads (ADR 0001, 0004):

  third_party/maia3/maia3-5m.f16      every tensor, float16 little-endian, back to back
  third_party/maia3/maia3-5m.json     the header: config, and per tensor name/shape/offset

The app never runs PyTorch; this script is the "source form" bridge between
the original `.pt` (the preferred form for modification, AGPL-3.0 §1) and the
converted weights. What the conversion changes, so the result is marked as
modified (AGPL-3.0 §5a):

  - float32 -> float16 (round to nearest even);
  - every Linear weight [out, in] is stored transposed, [in, out], and the
    shared geometric-attention-bias table [4096, 64] as [64, 4096], so the
    forward pass multiplies row-major activations by row-major weights;
  - the nine identical copies of that table in the state dict (one shared,
    one per block) are stored once (the script checks they are identical);
  - nothing else: no pruning, no fine-tuning, no re-ordering of values.

Needs Python 3.10+ and PyTorch (`torch.load(weights_only=True)`); nothing
else. The checkpoint is downloaded from Hugging Face at a pinned revision and
checked against its sha256 unless --checkpoint names a local copy (which is
checked too).

  python3 scripts/gen-maia3.py                       # download, convert
  python3 scripts/gen-maia3.py --checkpoint x.pt     # convert a local copy
"""
import argparse
import hashlib
import json
import os
import struct
import sys
import tempfile
import urllib.request

REPO = "UofTCSSLab/Maia3-5M"
REVISION = "b6559de2398d7140b985f28fd2c19fb5e47ddabe"
FILENAME = "maia3-5m.pt"
URL = f"https://huggingface.co/{REPO}/resolve/{REVISION}/{FILENAME}"
SHA256 = "ba14208b2992d85502f5fb501934abf6aaaeb355e9f3fdf90e326911f562524f"

# maia3/model_registry.py, "maia3-5m" (CSSLab/maia3 1e13597)
CONFIG = {
    "history": 8, "dim_emb": 128, "dim_vit": 256, "num_blocks": 8, "num_heads": 8,
    "mlp_dim": 512, "head_hid_dim": 256, "gab_gen_size": 64, "gab_intermediate_dim": 64,
    "elo_max": 5000, "norm": "rms", "activation": "gelu-erf",
}
ALIGN = 16  # elements: every tensor starts on a 32-byte boundary

ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
OUT_DIR = os.path.join(ROOT, "third_party", "maia3")


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def fetch(dest):
    print("downloading " + URL, file=sys.stderr)
    with urllib.request.urlopen(URL) as r, open(dest, "wb") as f:
        while True:
            b = r.read(1 << 20)
            if not b:
                break
            f.write(b)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--checkpoint", help="a local copy of " + FILENAME)
    ap.add_argument("--out", default=OUT_DIR)
    args = ap.parse_args()

    import torch  # only here, so --help works without it

    path = args.checkpoint
    tmp = None
    if not path:
        tmp = tempfile.mkdtemp()
        path = os.path.join(tmp, FILENAME)
        fetch(path)
    got = sha256(path)
    if got != SHA256:
        sys.exit(f"{path}: sha256 {got}, expected {SHA256}")

    sd = torch.load(path, map_location="cpu", weights_only=True)
    sd = sd.get("model_state_dict", sd)
    sd = {k.replace("smolgen", "gab"): v.float() for k, v in sd.items()}

    shared = sd["gab_shared_weight"]
    for i in range(CONFIG["num_blocks"]):
        k = f"transformer.layers.{i}.self_attn.gab_weight"
        if k in sd and not torch.equal(sd[k], shared):
            sys.exit(k + " differs from gab_shared_weight")

    tensors = []  # (name, tensor stored, source key, transposed)

    def add(name, key, t=False):
        v = sd[key]
        tensors.append((name, v.t().contiguous() if t else v.reshape(-1).contiguous() if v.dim() == 2 and v.shape[0] == 1 else v, key, t))

    add("gab", "gab_shared_weight", True)
    add("elo_low", "elo_embedding_low.weight")
    add("elo_high", "elo_embedding_high.weight")
    add("tok.w", "token_projection.weight", True)
    add("tok.b", "token_projection.bias")
    for i in range(CONFIG["num_blocks"]):
        p, q = f"transformer.layers.{i}.", f"b{i}."
        add(q + "qkv.w", p + "self_attn.mha.in_proj_weight", True)
        add(q + "out.w", p + "self_attn.mha.out_proj.weight", True)
        add(q + "gab1.w", p + "self_attn.sm2.weight", True)
        add(q + "gab1.b", p + "self_attn.sm2.bias")
        add(q + "gabn1.w", p + "self_attn.ln1.weight")
        add(q + "gabn1.b", p + "self_attn.ln1.bias")
        add(q + "gab2.w", p + "self_attn.sm3.weight", True)
        add(q + "gab2.b", p + "self_attn.sm3.bias")
        add(q + "gabn2.w", p + "self_attn.ln2.weight")
        add(q + "gabn2.b", p + "self_attn.ln2.bias")
        add(q + "mlp1.w", p + "linear1.weight", True)
        add(q + "mlp1.b", p + "linear1.bias")
        add(q + "mlp2.w", p + "linear2.weight", True)
        add(q + "mlp2.b", p + "linear2.bias")
        add(q + "norm1.w", p + "norm1.weight")
        add(q + "norm2.w", p + "norm2.weight")
    add("final.w", "transformer.norm.weight")
    add("final.b", "transformer.norm.bias")
    add("pool.w", "last_ln.weight")
    add("pool.b", "last_ln.bias")
    add("value1.w", "fc_value_hid.weight", True)
    add("value1.b", "fc_value_hid.bias")
    add("value2.w", "fc_value.weight", True)
    add("value2.b", "fc_value.bias")
    add("ponder1.w", "fc_ponder_hid.weight", True)
    add("ponder1.b", "fc_ponder_hid.bias")
    add("ponder2.w", "fc_ponder.weight", True)
    add("ponder2.b", "fc_ponder.bias")
    add("from.w", "proj_sq_from.weight", True)
    add("to.w", "proj_sq_to.weight", True)
    add("promo.w", "promo_bias_proj.weight", True)

    used = {k for _, _, k, _ in tensors} | {f"transformer.layers.{i}.self_attn.gab_weight" for i in range(CONFIG["num_blocks"])}
    left = sorted(set(sd) - used)
    if left:
        sys.exit("unconverted tensors: " + ", ".join(left))

    os.makedirs(args.out, exist_ok=True)
    blob = bytearray()
    header = []
    for name, v, key, t in tensors:
        while (len(blob) // 2) % ALIGN:
            blob += b"\0\0"
        h = v.to(torch.float16).contiguous()
        if not torch.isfinite(h).all():
            sys.exit(name + ": does not fit float16")
        header.append({"name": name, "shape": list(h.shape), "offset": len(blob) // 2,
                       "from": key + (" (transposed)" if t else "")})
        blob += h.numpy().astype("<f2").tobytes()
    bin_path = os.path.join(args.out, "maia3-5m.f16")
    with open(bin_path, "wb") as f:
        f.write(blob)
    meta = {
        "format": "maia3-f16/1",
        "dtype": "float16-le",
        "layout": "row-major; Linear weights transposed to [in, out]; offsets in elements",
        "source": {"url": URL, "repo": REPO, "revision": REVISION, "file": FILENAME, "sha256": SHA256,
                   "license": "AGPL-3.0 (CSSLab/maia3 LICENSE; the model card points to the repository)"},
        "modified": "converted by scripts/gen-maia3.py: float32 -> float16, Linear weights transposed, shared table stored once",
        "config": CONFIG,
        "elements": len(blob) // 2,
        "sha256": hashlib.sha256(blob).hexdigest(),
        "tensors": header,
    }
    with open(os.path.join(args.out, "maia3-5m.json"), "w") as f:
        json.dump(meta, f, indent=1)
        f.write("\n")
    print(f"{bin_path}: {len(blob)} bytes, {len(header)} tensors, sha256 {meta['sha256']}", file=sys.stderr)


if __name__ == "__main__":
    main()
