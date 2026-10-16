# Maia

Five of the nine Maia networks, unchanged, from
<https://github.com/CSSLab/maia-chess> (`maia_weights/`), fetched
2026-10-16. GPL-3.0 (the repository's `LICENSE`, copied here), the same
licence as this app.

> Reid McIlroy-Young, Siddhartha Sen, Jon Kleinberg, Ashton Anderson.
> *Aligning Superhuman AI with Human Behavior: Chess as a Model System.*
> KDD 2020.

Each net is a Leela Chess Zero network (6 SE residual blocks × 64 filters,
a convolutional policy head) trained on Lichess games of one rating band, to
predict the move a person of that band plays. The app runs the policy head
only (`src/web/js/human/maia-net.js`); `scripts/gen-maia-src.mjs` turns each
file into the chunk the app loads.

| file | band | sha256 |
|---|---|---|
| maia-1100.pb.gz | 1100–1199 | e1cf1cd0c96b8a4fa6a275f4b9fd54ed1ffebf9fe44641b9fceded310e9619c4 |
| maia-1300.pb.gz | 1300–1399 | 36195f87bf4761834baa0bf87472b18509a7261a9d7d6f1a8443261369a733f2 |
| maia-1500.pb.gz | 1500–1599 | 35ab6f20421d59e1df3b17c5a5016947af4c6761368ef84044a9a9c7619a9a00 |
| maia-1700.pb.gz | 1700–1799 | d277eacd792d340a30abb464dc65127254e65cac57abca17facc469889b96478 |
| maia-1900.pb.gz | 1900–1999 | e2f565f42d7cd9f122557e6dc4eb84e5bbaedceda1d404dc485d3611c7c97a12 |
