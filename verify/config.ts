import type { VerifyConfig } from "/Users/chrisshaw/code/video-verify/src/engine/index.ts";
const config: VerifyConfig = {
  baseURL: "https://chrisshawyeah.github.io", // the game lives under /voxel-pop/
  mainPath: ["01-", "02-", "03-"],
  playbackRate: Number(process.env.PLAYBACK_RATE ?? 2),
  transitionHoldMs: 1000,
  app: { name: "Crumble Crew", kind: "casual 3D cube-popping puzzle game, levels only, no menus" },
  viewport: { width: 1280, height: 800 },
  // The game is WebGL: without the graphics card a headless browser draws one frame every few seconds.
  browser: { args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"] },
  quality: {
    pages: ["/voxel-pop/", "/voxel-pop/?level=19"],
    crawl: false,
    viewports: [
      { id: "phone", width: 390, height: 844, dpr: 3, mobile: true },
      { id: "laptop", width: 1280, height: 800, dpr: 2 },
    ],
  },
};
export default config;
