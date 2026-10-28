// D0 spike: fetch Qwen3 4B into the local cache so later runs work with the network off.
// Run with QVAC_CONFIG_PATH=./qvac.config.js so the cache lands in ./.models.
import { close, downloadAsset, QWEN3_4B_INST_Q4_K_M } from "@qvac/sdk";

const started = Date.now();
let lastLogged = -1;

try {
  const modelId = await downloadAsset({
    assetSrc: QWEN3_4B_INST_Q4_K_M,
    onProgress: (p) => {
      const pct = Math.floor(p.percentage);
      if (pct === lastLogged || pct % 5 !== 0) return;
      lastLogged = pct;
      const mb = (n: number) => (n / 1e6).toFixed(0);
      const secs = ((Date.now() - started) / 1000).toFixed(0);
      console.log(`downloading ${pct}% (${mb(p.downloaded)}/${mb(p.total)} MB) after ${secs}s`);
    },
  });
  console.log(`done: ${modelId} in ${((Date.now() - started) / 1000).toFixed(0)}s`);
} catch (error) {
  console.error("download failed", error);
  process.exitCode = 1;
} finally {
  void close();
}
