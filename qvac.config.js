// QVAC requires an absolute cache path; keep models inside the repo (gitignored).
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export default {
  cacheDirectory: resolve(dirname(fileURLToPath(import.meta.url)), ".models"),
  loggerLevel: "info",
};
