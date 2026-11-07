/**
 * The styles of 学 and 我, on the 19.0 tokens. Added once, the first time
 * either page mounts; the shell's app.css stays the play screen's.
 * @module learn/style
 */
const CSS = `
.learn [hidden], .me [hidden] { display: none !important; }
.learn, .me { --board: min(calc(100vh - 230px), calc(100vw - 420px), 760px); padding: 16px 20px; display: flex; flex-direction: column; gap: 12px; align-items: center; }
.learn-head { width: min(100%, calc(var(--board) + 340px)); display: flex; align-items: center; gap: 12px; }
.learn-head h1 { margin: 0; font-family: var(--font-title); font-weight: 600; font-size: 1.25rem; }
.learn-head .left { color: var(--muted); font-variant-numeric: tabular-nums; }
.learn-head .chip { padding: 2px 10px; border-radius: var(--radius-full); background: var(--accent-soft, var(--btn-hover)); font-size: .875rem; }
.learn-head .end { margin-left: auto; }
.learn-main { display: flex; gap: 20px; align-items: flex-start; }
.learn-stage { display: flex; flex-direction: column; gap: 8px; width: var(--board); min-width: 260px; }
.learn .board-box { width: 100%; aspect-ratio: 1; position: relative; }
.learn-side { width: 300px; display: flex; flex-direction: column; gap: 10px; }
.learn-side h2 { margin: 0; font-family: var(--font-title); font-weight: 600; font-size: 1.25rem; }
.learn-side .why { margin: 0; color: var(--text); line-height: var(--lh-body); }
.learn-side .lesson p { margin: 0 0 8px; color: var(--muted); line-height: var(--lh-body); }
.learn-side .group { color: var(--muted); font-size: .875rem; margin: 0; }
.learn button, .me button {
  height: var(--ctl-h); padding: 0 14px; border-radius: var(--radius-sm); cursor: pointer;
  background: var(--btn-lift); border: 1px solid var(--btn-edge); box-shadow: var(--elev-1);
}
.learn button:hover:not(:disabled), .me button:hover:not(:disabled) { background: var(--btn-lift-hover); }
.learn button:disabled, .me button:disabled { opacity: .45; cursor: default; }
.learn button.primary, .me button.primary { background: var(--accent); color: var(--on-accent); border-color: transparent; }
.learn button.quiet { background: transparent; box-shadow: none; border-color: transparent; color: var(--muted); }
.place { display: grid; gap: 10px; width: min(460px, 100%); margin-top: 8vh; }
.place h1 { font-family: var(--font-title); font-weight: 600; font-size: 1.5rem; margin: 0 0 8px; text-align: center; }
.learn .place button { height: auto; padding: 14px 16px; text-align: left; display: flex; flex-direction: column; gap: 2px; }
.place small { color: var(--muted); }
.skill-map { width: min(100%, calc(var(--board) + 340px)); display: grid; gap: 14px; }
.skill-map section h3 { margin: 0 0 6px; font-size: .875rem; color: var(--muted); font-weight: 600; }
.skill-map .chips { display: flex; flex-wrap: wrap; gap: 6px; }
.learn .skill-map .chips button { height: auto; padding: 5px 10px; font-size: .875rem; box-shadow: none; }
.skill-map button[data-state="lit"] { background: var(--accent-soft, var(--btn-hover)); }
.skill-map button[data-state="now"] { border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent) inset; font-weight: 600; }
.skill-map button[data-state="locked"] { opacity: .5; }
.skill-map button[data-state="lit"]::before { content: "✓ "; }
.skill-detail { padding: 12px 14px; background: var(--card); border: 1px solid var(--card-edge); border-radius: var(--radius-md); display: grid; gap: 8px; }
.skill-detail h2 { margin: 0; font-family: var(--font-title); font-size: 1.125rem; }
.skill-detail p { margin: 0; }
.skill-detail .muted { color: var(--muted); font-size: .875rem; }
.me { align-items: stretch; max-width: 720px; margin: 0 auto; }
.me .card { padding: 16px 18px; background: var(--card); border: 1px solid var(--card-edge); border-radius: var(--radius-md); display: grid; gap: 8px; }
.me .card h2 { margin: 0; font-size: .875rem; color: var(--muted); font-weight: 600; }
.me .level { display: flex; align-items: baseline; gap: 12px; }
.me .level .num { font-family: var(--font-title); font-size: 3rem; font-weight: 600; font-variant-numeric: tabular-nums; line-height: 1; }
.me .curve { width: 100%; height: 120px; display: block; }
.me .curve polyline { fill: none; stroke: var(--accent); stroke-width: 2; vector-effect: non-scaling-stroke; }
.me .curve .base { stroke: var(--line); stroke-width: 1; vector-effect: non-scaling-stroke; }
.me .needs { display: flex; flex-wrap: wrap; gap: 6px; margin: 0; padding: 0; list-style: none; }
.me .needs li { padding: 2px 10px; border-radius: var(--radius-full); background: var(--btn-hover); font-size: .875rem; }
.me .muted { color: var(--muted); margin: 0; }
.me[hidden], .lib-game[hidden] { display: none !important; }
.me .small { font-size: .8125rem; }
.me .you-ask { padding: 10px 12px; border: 1px solid var(--accent); border-radius: var(--radius-sm); display: grid; gap: 6px; }
.me .you-ask .q { margin: 0; font-weight: 600; }
.me .you-ask .names { display: flex; flex-wrap: wrap; gap: 6px; }
.me button.quiet { background: transparent; box-shadow: none; border-color: transparent; color: var(--muted); }
.me .lib-box { display: grid; gap: 8px; }
.me .lib-filter { display: flex; flex-wrap: wrap; gap: 6px; }
.me .lib-filter input { flex: 1 1 180px; min-width: 0; }
.me .lib-filter input, .me .lib-filter select { height: var(--ctl-h); padding: 0 8px; border-radius: var(--radius-sm); border: 1px solid var(--btn-edge); background-color: var(--bg, var(--card)); color: var(--text); font: inherit; }
.me .lib-filter select { padding-right: 26px; }
.me .lib-list { margin: 0; padding: 0; list-style: none; display: grid; gap: 2px; }
.me .lib-list > li.muted { padding: 6px 2px; }
.me button.lib-row { width: 100%; height: auto; min-height: var(--ctl-h); padding: 6px 10px; box-shadow: none; border-color: transparent; background: transparent;
  display: grid; grid-template-columns: 7.5em minmax(0, 1fr) auto auto; gap: 10px; align-items: baseline; text-align: left; }
.me button.lib-row:hover { background: var(--btn-hover); }
.me .lib-row .when, .me .lib-row .tags { color: var(--muted); font-size: .875rem; font-variant-numeric: tabular-nums; }
.me .lib-row .who { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.me .lib-row[data-outcome="win"] .res { color: var(--judge-good, var(--win)); }
.me .lib-row[data-outcome="loss"] .res { color: var(--judge-bad, var(--danger)); }
.me .lib-pager { display: flex; align-items: center; gap: 8px; }
.me .lib-pager [data-test="lib-total"] { margin-left: auto; }
.lib-game .lib-head { gap: 10px; justify-content: flex-start; }
.lib-game .lib-head .who { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.lib-game .lib-head .muted { color: var(--muted); font-size: .875rem; margin-left: auto; white-space: nowrap; }
.lib-game .drawer { margin-top: 36px; }
@media (max-width: 600px) {
  .me button.lib-row { grid-template-columns: minmax(0, 1fr) auto; }
  .me .lib-row .when, .me .lib-row .tags { grid-column: 1 / -1; }
}
@media (max-width: 900px) {
  .learn { --board: min(calc(100vw - 40px), calc(100vh - 300px)); }
  .learn-main { flex-direction: column; }
  .learn-side { width: var(--board); }
}
`;

let added = false;
export function addStyle() {
  if (added || typeof document === "undefined") return;
  added = true;
  const s = document.createElement("style");
  s.dataset.styles = "learn";
  s.textContent = CSS;
  document.head.append(s);
}
