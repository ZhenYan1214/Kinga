// D3 spike: fetch Qwen3-VL 2B and its image projection into ./.models for reading payment screenshots offline.
// npm run spike:download-vision
import "./qvac-env.js";
import { close, downloadAsset, MMPROJ_QWEN3VL_2B_MULTIMODAL_Q4_K, QWEN3VL_2B_MULTIMODAL_Q4_K } from "@qvac/sdk";

const started = Date.now();
try {
  for (const asset of [QWEN3VL_2B_MULTIMODAL_Q4_K, MMPROJ_QWEN3VL_2B_MULTIMODAL_Q4_K]) {
    let lastLogged = -1;
    await downloadAsset({
      assetSrc: asset,
      onProgress: (p) => {
        const pct = Math.floor(p.percentage);
        if (pct === lastLogged || pct % 10 !== 0) return;
        lastLogged = pct;
        console.log(`${asset.name} ${pct}% (${(p.downloaded / 1e6).toFixed(0)}/${(p.total / 1e6).toFixed(0)} MB) after ${((Date.now() - started) / 1000).toFixed(0)}s`);
      },
    });
    console.log(`done: ${asset.name}`);
  }
} catch (error) {
  console.error("download failed", error);
  process.exitCode = 1;
} finally {
  void close();
}
