// Point the QVAC SDK at the repo's config (absolute .models cache) without needing env vars in npm scripts.
// Import this before "@qvac/sdk".
import { fileURLToPath } from "node:url";

process.env.QVAC_CONFIG_PATH ??= fileURLToPath(new URL("../qvac.config.js", import.meta.url));
