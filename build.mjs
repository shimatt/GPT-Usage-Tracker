// Builds the extension into dist/ (load it via chrome://extensions → Load unpacked).
//   node build.mjs             one-off build
//   node build.mjs --watch     rebuild on change
//   node build.mjs --test      bundle tests/*.test.ts and run them with node --test
//   node build.mjs --package   build, then zip dist/ into release/usage-meter.zip for a GitHub Release
import { spawnSync } from "node:child_process";
import { copyFile, cp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { deflateSync } from "node:zlib";
import * as esbuild from "esbuild";

const watch = process.argv.includes("--watch");
const test = process.argv.includes("--test");
const pack = process.argv.includes("--package");
const DIST = "dist";
const RELEASE = "release";
const ZIP_FOLDER = "usage-meter"; // the folder people get when they unzip the download
const { version } = JSON.parse(await readFile("package.json", "utf8"));

const shared = {
  bundle: true,
  target: "chrome120",
  loader: { ".css": "text" },
  legalComments: "none",
  logLevel: "info",
};

async function runTests() {
  const out = ".test-build";
  await rm(out, { recursive: true, force: true });
  const files = (await readdir("tests")).filter((f) => f.endsWith(".test.ts"));
  await esbuild.build({
    ...shared,
    entryPoints: files.map((f) => `tests/${f}`),
    outdir: out,
    outExtension: { ".js": ".mjs" },
    platform: "node",
    format: "esm",
    target: "node20",
    logLevel: "warning",
  });
  const built = files.map((f) => `${out}/${f.replace(/\.ts$/, ".mjs")}`);
  const result = spawnSync(process.execPath, ["--test", ...built], { stdio: "inherit", env: { ...process.env, TZ: "UTC" } });
  process.exit(result.status ?? 1);
}

// ───────── Icons: a blue rounded square with two meter bars, rasterized without dependencies ─────────

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePng(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filter: none
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function inRoundRect(u, v, x0, y0, x1, y1, r) {
  if (u < x0 || u > x1 || v < y0 || v > y1) return false;
  const cx = Math.min(Math.max(u, x0 + r), x1 - r);
  const cy = Math.min(Math.max(v, y0 + r), y1 - r);
  return (u - cx) ** 2 + (v - cy) ** 2 <= r * r;
}

const BLUE = [47, 111, 235];
const BARS = [
  { y0: 0.33, y1: 0.45, fill: 0.45 },
  { y0: 0.55, y1: 0.67, fill: 0.8 },
];

function sample(u, v) {
  if (!inRoundRect(u, v, 0, 0, 1, 1, 0.22)) return [0, 0, 0, 0];
  for (const bar of BARS) {
    if (inRoundRect(u, v, 0.2, bar.y0, 0.8, bar.y1, (bar.y1 - bar.y0) / 2)) {
      const filled = u <= 0.2 + 0.6 * bar.fill;
      const t = filled ? 1 : 0.35;
      return [...BLUE.map((c) => c + (255 - c) * t), 1];
    }
  }
  return [...BLUE, 1];
}

function drawIcon(size) {
  const ss = 4;
  const out = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const [cr, cg, cb, ca] = sample((x + (sx + 0.5) / ss) / size, (y + (sy + 0.5) / ss) / size);
          r += cr * ca; g += cg * ca; b += cb * ca; a += ca;
        }
      }
      const i = (y * size + x) * 4;
      if (a > 0) {
        out[i] = Math.round(r / a);
        out[i + 1] = Math.round(g / a);
        out[i + 2] = Math.round(b / a);
      }
      out[i + 3] = Math.round((a / (ss * ss)) * 255);
    }
  }
  return encodePng(size, out);
}

// ───────── Extension build ─────────

async function copyStatic() {
  await mkdir(`${DIST}/icons`, { recursive: true });
  // package.json is the one place the version is set.
  const manifest = JSON.parse(await readFile("manifest.json", "utf8"));
  manifest.version = version;
  await Promise.all([
    writeFile(`${DIST}/manifest.json`, `${JSON.stringify(manifest, null, 2)}\n`),
    copyFile("src/popup/popup.html", `${DIST}/popup.html`),
    copyFile("src/popup/popup.css", `${DIST}/popup.css`),
    ...[16, 32, 48, 128].map((size) => writeFile(`${DIST}/icons/${size}.png`, drawIcon(size))),
  ]);
}

const copyStaticPlugin = {
  name: "copy-static",
  setup(build) {
    build.onEnd(async (result) => {
      if (result.errors.length === 0) await copyStatic();
    });
  },
};

async function buildExtension() {
  await rm(DIST, { recursive: true, force: true });
  const ctx = await esbuild.context({
    ...shared,
    entryPoints: {
      content: "src/content/index.ts",
      sw: "src/background/sw.ts",
      popup: "src/popup/popup.ts",
    },
    outdir: DIST,
    format: "iife",
    sourcemap: watch ? "inline" : false,
    plugins: [copyStaticPlugin],
  });
  if (watch) {
    await ctx.watch();
    console.log("Watching for changes… reload the extension in chrome://extensions after each build.");
  } else {
    await ctx.rebuild();
    await ctx.dispose();
  }
}

/** Zips dist/ as usage-meter/… so unzipping gives one ready-to-load folder. */
async function packageRelease() {
  await rm(RELEASE, { recursive: true, force: true });
  await cp(DIST, `${RELEASE}/${ZIP_FOLDER}`, { recursive: true });
  const zip = spawnSync("zip", ["-r", "-q", "-X", "usage-meter.zip", ZIP_FOLDER, "-x", "*.DS_Store"], { cwd: RELEASE, stdio: "inherit" });
  if (zip.status !== 0) throw new Error("zip failed — is the `zip` command installed?");
  await rm(`${RELEASE}/${ZIP_FOLDER}`, { recursive: true });
  console.log(`Packaged v${version} → ${RELEASE}/usage-meter.zip`);
}

if (test) await runTests();
else {
  await buildExtension();
  if (pack && !watch) await packageRelease();
}
