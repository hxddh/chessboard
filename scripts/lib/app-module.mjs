/**
 * The repository root, for scripts that read files by their path in it.
 */
import path from "path";
import { fileURLToPath } from "url";

export const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
