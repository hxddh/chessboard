/**
 * Load app ES modules into a vm context, exports landing as globals — the
 * same trick scripts/test-chess.mjs uses, lifted out so the importer and
 * scripts/test-learning.mjs share it. Importing src/web/js/*.js directly
 * works too, but package.json has no "type" and Node prints a reparse
 * warning per file; the bundler route is warning-free and already proven.
 */
import path from "path";
import vm from "vm";
import { fileURLToPath } from "url";
import { compileModuleSync } from "../bundle.mjs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

/** @returns {object} a context with every named module's exports as globals */
export function loadAppModules(rels) {
  const ctx = { console, Date, performance, Math };
  ctx.globalThis = ctx;
  ctx.window = ctx;
  vm.createContext(ctx);
  for (const rel of rels) {
    const abs = path.isAbsolute(rel) ? rel : path.join(root, rel);
    vm.runInContext(compileModuleSync(abs), ctx, { filename: path.basename(abs) });
  }
  return ctx;
}

export const ROOT = root;
