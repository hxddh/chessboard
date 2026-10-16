/**
 * Node tests for the vendored rules engine (chess.js) — the app's single
 * source of truth for legality — and the static guards around it.
 * Run: node scripts/test-chess.mjs
 *
 * The checks live in scripts/test/, one module per domain. This runs them one
 * after another in the order they were written in: later ones read what
 * earlier ones loaded into the shared context (scripts/test/harness.mjs).
 */
import { failures } from "./test/harness.mjs";
import * as rules from "./test/rules.mjs";
import * as content from "./test/content.mjs";
import * as keyboard from "./test/keyboard.mjs";
import * as design from "./test/design.mjs";
import * as opponents from "./test/opponents.mjs";
import * as review from "./test/review.mjs";
import * as drills from "./test/drills.mjs";
import * as tools from "./test/tools.mjs";
import * as trainer from "./test/trainer.mjs";
import * as i18nUi from "./test/i18n-ui.mjs";
import * as achievements from "./test/achievements.mjs";
import * as nativeBridge from "./test/native-bridge.mjs";
import * as scope from "./test/scope.mjs";
import * as copy from "./test/copy.mjs";
import * as readme from "./test/readme.mjs";
import * as persist from "./test/persist.mjs";
import * as firstPaint from "./test/first-paint.mjs";
import * as automation from "./test/automation.mjs";
import * as visionDrills from "./test/vision-drills.mjs";
import * as ci from "./test/ci.mjs";
import * as fen from "./test/fen.mjs";
import * as layout from "./test/layout.mjs";
import * as appModules from "./test/app-modules.mjs";
import * as syncChartsSounds from "./test/sync-charts-sounds.mjs";

for (const domain of [
  rules, content, keyboard, design, opponents, review, drills, tools, trainer,
  i18nUi, achievements, nativeBridge, scope, copy, readme, persist, firstPaint,
  automation, visionDrills, ci, fen, layout, appModules, syncChartsSounds,
]) {
  await domain.run();
}

const failed = failures();
if (failed) {
  console.error(failed + " test(s) failed");
  process.exit(1);
}
console.log("all passed");
