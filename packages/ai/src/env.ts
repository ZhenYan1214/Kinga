// Point the QVAC SDK at the repo's config (absolute .models cache). Imported before "@qvac/sdk".
import { fileURLToPath } from "node:url";

process.env.QVAC_CONFIG_PATH ??= fileURLToPath(new URL("../../../qvac.config.js", import.meta.url));
