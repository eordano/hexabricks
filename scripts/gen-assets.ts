#!/usr/bin/env node
"use strict";
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const core = require(path.join(__dirname, "..", "src", "hexbrick-core.ts"));

const { S, SQ3, SHAPES, elemsFor, outlinePts, center, vert, triAt, pointToCell } = core;
const GRID_R = 10;
const INSET = 0.035;
const GLOW_BAND = 0.18;

const { BRICK_COLORS: PALETTE } = require(path.join(__dirname, "..", "src", "brick-palette.ts"));

const MODELS = path.join(__dirname, "..", "models");
const ICONS = path.join(__dirname, "..", "images", "icons");
const HUD = path.join(__dirname, "..", "images", "hud");
for (const dir of [MODELS, ICONS, HUD]) fs.mkdirSync(dir, { recursive: true });
const SS4 = [[0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]];

const FLIPX = 1;

function hexToRgb(hex) {
  const v = parseInt(hex.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
function cross(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }

function meshBuilder() {
  const pos = [], nrm = [], idx = [], uv = [];
  function tri(a, b, c, want, st) {
    let A = [FLIPX * a[0], a[1], a[2]];
    let B = [FLIPX * b[0], b[1], b[2]];
    let C = [FLIPX * c[0], c[1], c[2]];
    let [ua, ub, uc] = st && Array.isArray(st[0]) ? st : [st, st, st];
    const w = [FLIPX * want[0], want[1], want[2]];
    let n = cross(sub(B, A), sub(C, A));
    const len = Math.hypot(n[0], n[1], n[2]) || 1;
    n = [n[0] / len, n[1] / len, n[2] / len];
    if (dot(n, w) < 0) {
      const t = B; B = C; C = t;
      const tu = ub; ub = uc; uc = tu;
      n = [-n[0], -n[1], -n[2]];
    }
    const base = pos.length / 3;
    for (const p of [A, B, C]) pos.push(p[0], p[1], p[2]);
    for (const s of [ua, ub, uc]) {
      nrm.push(n[0], n[1], n[2]);
      uv.push(s ? s[0] : 0, s ? s[1] : 0);
    }
    idx.push(base, base + 1, base + 2);
  }
  return { pos, nrm, idx, uv, tri };
}

function align4(buf, fill) {
  const pad = (4 - (buf.length % 4)) % 4;
  return pad ? Buffer.concat([buf, Buffer.alloc(pad, fill)]) : buf;
}
function buildGlb(primitives, materials, nodeName, textured) {
  const views = [], accessors = [], bins = [];
  let offset = 0;
  function addBuffer(buf, target) {
    const b = align4(buf, 0);
    views.push({ buffer: 0, byteOffset: offset, byteLength: buf.length, target });
    bins.push(b);
    offset += b.length;
    return views.length - 1;
  }
  const accessor = (array, target, componentType, count, type, extra = {}) =>
    accessors.push({ bufferView: addBuffer(Buffer.from(array.buffer), target), componentType, count, type, ...extra }) - 1;
  const prims = primitives.map((p) => {
    const vCount = p.pos.length / 3;
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < p.pos.length; i += 3)
      for (let k = 0; k < 3; k++) {
        min[k] = Math.min(min[k], p.pos[i + k]);
        max[k] = Math.max(max[k], p.pos[i + k]);
      }
    const attributes = {
      POSITION: accessor(new Float32Array(p.pos), 34962, 5126, vCount, "VEC3", { min, max }),
      NORMAL: accessor(new Float32Array(p.nrm), 34962, 5126, vCount, "VEC3")
    };
    if (textured) attributes.TEXCOORD_0 = accessor(new Float32Array(p.uv), 34962, 5126, vCount, "VEC2");
    const indices = accessor(new Uint16Array(p.idx), 34963, 5123, p.idx.length, "SCALAR");
    return { attributes, indices, material: p.material, mode: 4 };
  });
  const bin = Buffer.concat(bins);
  const json = {
    asset: { version: "2.0", generator: "hexabricks gen-assets" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0, name: nodeName }],
    meshes: [{ primitives: prims }],
    materials,
    bufferViews: views,
    accessors,
    buffers: [{ byteLength: bin.length }]
  };
  if (textured) {
    const images = textured.images || ["palette.png", "palette-emissive.png"];
    const wrap = textured.wrap || 33071;
    json.samplers = [{ magFilter: 9729, minFilter: 9729, wrapS: wrap, wrapT: wrap }];
    json.images = images.map((uri) => ({ uri }));
    json.textures = images.map((_, i) => ({ sampler: 0, source: i }));
  }
  const jsonBuf = align4(Buffer.from(JSON.stringify(json)), 0x20);
  const total = 12 + 8 + jsonBuf.length + 8 + bin.length;
  const out = Buffer.alloc(total);
  out.writeUInt32LE(0x46546c67, 0);
  out.writeUInt32LE(2, 4);
  out.writeUInt32LE(total, 8);
  out.writeUInt32LE(jsonBuf.length, 12);
  out.writeUInt32LE(0x4e4f534a, 16);
  jsonBuf.copy(out, 20);
  out.writeUInt32LE(bin.length, 20 + jsonBuf.length);
  out.writeUInt32LE(0x004e4942, 24 + jsonBuf.length);
  bin.copy(out, 28 + jsonBuf.length);
  return out;
}

function srgbToLinear(c) { return Math.pow(c / 255, 2.2); }
function baseColor(hex, alpha) {
  return [
    srgbToLinear((hex >> 16) & 255),
    srgbToLinear((hex >> 8) & 255),
    srgbToLinear(hex & 255),
    alpha
  ];
}
function ghostMaterial(hex, alpha, name) {
  return {
    name, alphaMode: "BLEND", doubleSided: true,
    pbrMetallicRoughness: {
      baseColorFactor: baseColor(hex, alpha), metallicFactor: 0, roughnessFactor: 1
    }
  };
}
function texturedMaterial(name, metallicFactor, roughnessFactor) {
  return {
    name,
    pbrMetallicRoughness: { baseColorTexture: { index: 0 }, metallicFactor, roughnessFactor },
    emissiveTexture: { index: 1 },
    emissiveFactor: [1, 1, 1]
  };
}

function polyArea2(pts) {
  let a2 = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    a2 += a.x * b.z - b.x * a.z;
  }
  return a2;
}
function insetPolygon(pts, d) {
  const n = pts.length;
  const s = polyArea2(pts) > 0 ? 1 : -1;
  const lines = [];
  for (let i = 0; i < n; i++) {
    const a = pts[i], b = pts[(i + 1) % n];
    const dx = b.x - a.x, dz = b.z - a.z, l = Math.hypot(dx, dz) || 1;
    const nx = (-s * dz / l) * d, nz = (s * dx / l) * d;
    lines.push({ px: a.x + nx, pz: a.z + nz, dx, dz });
  }
  const out = [];
  for (let i = 0; i < n; i++) {
    const L1 = lines[(i + n - 1) % n], L2 = lines[i];
    const cr = L1.dx * L2.dz - L1.dz * L2.dx;
    if (Math.abs(cr) < 1e-9) { out.push({ x: L2.px, z: L2.pz }); continue; }
    const wx = L2.px - L1.px, wz = L2.pz - L1.pz;
    const t = (wx * L2.dz - wz * L2.dx) / cr;
    out.push({ x: L1.px + t * L1.dx, z: L1.pz + t * L1.dz });
  }
  return out.filter((p, i) => {
    const a = out[(i + out.length - 1) % out.length], c = out[(i + 1) % out.length];
    return Math.abs((p.x - a.x) * (c.z - a.z) - (p.z - a.z) * (c.x - a.x)) > 1e-9;
  });
}
function pointStrictlyInTri(p, a, b, c) {
  const e = 1e-9;
  const s1 = (b.x - a.x) * (p.z - a.z) - (b.z - a.z) * (p.x - a.x);
  const s2 = (c.x - b.x) * (p.z - b.z) - (c.z - b.z) * (p.x - b.x);
  const s3 = (a.x - c.x) * (p.z - c.z) - (a.z - c.z) * (p.x - c.x);
  return s1 > e && s2 > e && s3 > e;
}
function triangulate(ptsIn) {
  const pts = polyArea2(ptsIn) < 0 ? ptsIn.slice().reverse() : ptsIn.slice();
  const idx = pts.map((_, i) => i);
  const tris = [];
  let guard = 0;
  while (idx.length > 3 && guard++ < 10000) {
    let clipped = false;
    for (let i = 0; i < idx.length; i++) {
      const a = pts[idx[(i + idx.length - 1) % idx.length]];
      const b = pts[idx[i]];
      const c = pts[idx[(i + 1) % idx.length]];
      const cross = (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x);
      if (cross <= 1e-9) continue;
      let blocked = false;
      for (const j of idx)
        if (pts[j] !== a && pts[j] !== b && pts[j] !== c && pointStrictlyInTri(pts[j], a, b, c)) {
          blocked = true;
          break;
        }
      if (blocked) continue;
      tris.push([a, b, c]);
      idx.splice(i, 1);
      clipped = true;
      break;
    }
    if (!clipped) throw new Error("triangulate: no ear found");
  }
  tris.push([pts[idx[0]], pts[idx[1]], pts[idx[2]]]);
  return tris;
}

function brickMesh(defIdx, baseUV, glowUV) {
  const sp = insetPolygon(outlinePts(defIdx, 0), INSET);
  const m = meshBuilder();
  for (const [a, b, c] of triangulate(sp)) {
    m.tri([a.x, 1, a.z], [b.x, 1, b.z], [c.x, 1, c.z], [0, 1, 0], baseUV);
    m.tri([a.x, 0, a.z], [b.x, 0, b.z], [c.x, 0, c.z], [0, -1, 0], baseUV);
  }
  const sign = polyArea2(sp) > 0 ? 1 : -1;
  const ySplit = 1 - GLOW_BAND;
  for (let i = 0; i < sp.length; i++) {
    const a = sp[i], b = sp[(i + 1) % sp.length];
    const dx = b.x - a.x, dz = b.z - a.z;
    const l = Math.hypot(dx, dz) || 1;
    const n = [sign * dz / l, 0, -sign * dx / l];
    for (const [y0, y1, st] of [[0, ySplit, baseUV], [ySplit, 1, glowUV]]) {
      m.tri([a.x, y0, a.z], [b.x, y0, b.z], [b.x, y1, b.z], n, st);
      m.tri([a.x, y0, a.z], [b.x, y1, b.z], [a.x, y1, a.z], n, st);
    }
  }
  return m;
}

const FLOOR_PERIOD = { w: S * SQ3, h: 3 * S };
function boardMesh() {
  const disc = meshBuilder();
  const R = (GRID_R + 1.2) * S * SQ3;
  const SEGS = 64;
  const uvAt = (x, z) => [x / FLOOR_PERIOD.w, z / FLOOR_PERIOD.h];
  for (let i = 0; i < SEGS; i++) {
    const a0 = (i / SEGS) * 2 * Math.PI, a1 = ((i + 1) / SEGS) * 2 * Math.PI;
    const p0 = [R * Math.cos(a0), 0, R * Math.sin(a0)];
    const p1 = [R * Math.cos(a1), 0, R * Math.sin(a1)];
    disc.tri([0, 0, 0], p0, p1, [0, 1, 0], [
      uvAt(0, 0),
      uvAt(p0[0], p0[2]),
      uvAt(p1[0], p1[2])
    ]);
  }
  return { disc };
}

function writeFloorTile() {
  const PXW = 256, PXH = 512;
  const LINE_W = 0.05, HALO_W = 0.3, AA = 0.012;
  const APOTHEM = (S * SQ3) / 2;
  const bgMid = hexToRgb("#082e33"), bgEdge = hexToRgb("#0e4d52");
  const line = hexToRgb("#6ef5e6");
  const edgeDist = (x, z) => {
    const { q, r } = pointToCell(x, z);
    const c = center(q, r);
    const dx = x - c.x, dz = z - c.z;
    let m = 0;
    for (const a of [0, Math.PI / 3, (2 * Math.PI) / 3])
      m = Math.max(m, Math.abs(dx * Math.cos(a) + dz * Math.sin(a)));
    return Math.max(0, APOTHEM - m);
  };
  const clamp01 = (v) => Math.min(1, Math.max(0, v));
  const smooth = (t) => t * t * (3 - 2 * t);
  const albedo = Buffer.alloc(PXW * PXH * 4);
  const emissive = Buffer.alloc(PXW * PXH * 4);
  for (let py = 0; py < PXH; py++)
    for (let px = 0; px < PXW; px++) {
      let a = [0, 0, 0], e = [0, 0, 0];
      for (const [sx, sy] of SS4) {
        const x = ((px + sx) / PXW) * FLOOR_PERIOD.w;
        const z = ((py + sy) / PXH) * FLOOR_PERIOD.h;
        const t = edgeDist(x, z);
        const core = smooth(clamp01((LINE_W + AA - t) / (2 * AA)));
        const halo = Math.pow(clamp01(1 - t / HALO_W), 2);
        const rim = Math.pow(clamp01(1 - t / APOTHEM), 2);
        for (let k = 0; k < 3; k++) {
          const bg = bgMid[k] + (bgEdge[k] - bgMid[k]) * rim;
          a[k] += bg + (line[k] * 0.45 - bg * 0.45) * halo + (line[k] - bg) * core;
          e[k] += line[k] * clamp01(core + 0.4 * halo);
        }
      }
      const o = (py * PXW + px) * 4;
      for (let k = 0; k < 3; k++) {
        albedo[o + k] = Math.round(clamp01(a[k] / 4 / 255) * 255);
        emissive[o + k] = Math.round(clamp01(e[k] / 4 / 255) * 255);
      }
      albedo[o + 3] = 255;
      emissive[o + 3] = 255;
    }
  writePng(path.join(MODELS, "hexfloor.png"), PXW, PXH, albedo);
  writePng(path.join(MODELS, "hexfloor-emissive.png"), PXW, PXH, emissive);
}

function sdRoundRect(px, py, w, h, r) {
  const qx = Math.abs(px - w / 2) - (w / 2 - r);
  const qy = Math.abs(py - h / 2) - (h / 2 - r);
  return (
    Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r
  );
}
function bakeRounded(file, w, h, r, layers) {
  const rgba = Buffer.alloc(w * h * 4);
  const cov = (d) => Math.min(1, Math.max(0, 0.5 - d));
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let cr = 0, cg = 0, cb = 0, ca = 0;
      for (const [sx, sy] of SS4) {
        const px = x + sx, py = y + sy;
        let ar = 0, ag = 0, ab = 0, aa = 0;
        for (const L of layers) {
          const i = L.inset || 0;
          const d = sdRoundRect(px - i, py - i, w - 2 * i, h - 2 * i, Math.max(0.5, r - i));
          const a = (L.border ? Math.max(0, cov(d) - cov(d + L.border)) : cov(d)) * L.alpha;
          const t = L.grad ? px / w : 0;
          const col = L.grad
            ? L.color.map((c, k) => c + (L.grad[k] - c) * t)
            : L.color;
          ar = col[0] * a + ar * (1 - a);
          ag = col[1] * a + ag * (1 - a);
          ab = col[2] * a + ab * (1 - a);
          aa = a + aa * (1 - a);
        }
        cr += ar; cg += ag; cb += ab; ca += aa;
      }
      const o = (y * w + x) * 4, a4 = ca / 4;
      rgba[o] = Math.round(a4 ? cr / 4 / a4 : 0);
      rgba[o + 1] = Math.round(a4 ? cg / 4 / a4 : 0);
      rgba[o + 2] = Math.round(a4 ? cb / 4 / a4 : 0);
      rgba[o + 3] = Math.round(a4 * 255);
    }
  writePng(file, w, h, rgba);
}
function writeHudSprites() {
  const W = [255, 255, 255];
  const solid = [{ color: W, alpha: 1 }];
  const ring = [{ color: W, alpha: 1, border: 2 }];
  const panel = (alpha) => [{ color: [22, 21, 24], alpha }, { color: W, alpha: 0.1, border: 1 }];
  const sprites = [
    ["rect5", 24, 24, 5, solid], ["rect8", 32, 32, 8, solid], ["rect12", 44, 44, 12, solid], ["rect20", 64, 64, 20, solid],
    ["ring8", 32, 32, 8, ring], ["ring12", 44, 44, 12, ring], ["circle", 32, 32, 16, solid], ["circlering", 36, 36, 18, ring],
    ["caps", 48, 48, 24, solid], ["panel62", 64, 64, 20, panel(0.62)], ["panel72", 64, 64, 20, panel(0.72)],
    ["caps85", 48, 48, 24, panel(0.85)],
    ["progress", 128, 6, 3, [{ color: [255, 45, 85], alpha: 1, grad: [255, 188, 91] }]],
    ["chiphost", 64, 20, 10, [{ color: [138, 77, 255], alpha: 1, grad: [195, 107, 255] }]]
  ];
  for (const [name, w, h, r, layers] of sprites) bakeRounded(path.join(HUD, `${name}.png`), w, h, r, layers);
  console.log("hud: 9-slice chrome + gradient chips baked");
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function pngChunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "ascii");
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}
function writePng(file, w, h, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  const raw = Buffer.alloc(h * (1 + w * 4));
  for (let y = 0; y < h; y++)
    rgba.copy(raw, y * (1 + w * 4) + 1, y * w * 4, (y + 1) * w * 4);
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    pngChunk("IEND", Buffer.alloc(0))
  ]);
  fs.writeFileSync(file, png);
}

const CELL = 16;
function writeAtlas(file, rows) {
  const W = PALETTE.length * CELL, H = rows.length * CELL;
  const rgba = Buffer.alloc(W * H * 4);
  rows.forEach((rowColors, row) => {
    rowColors.forEach((hex, col) => {
      const [r, g, b] = hexToRgb(hex);
      for (let y = row * CELL; y < (row + 1) * CELL; y++)
        for (let x = col * CELL; x < (col + 1) * CELL; x++) {
          const o = (y * W + x) * 4;
          rgba[o] = r; rgba[o + 1] = g; rgba[o + 2] = b; rgba[o + 3] = 255;
        }
    });
  });
  writePng(file, W, H, rgba);
}
function cellUV(col, row) {
  return [(col + 0.5) / PALETTE.length, (row + 0.5) / 2];
}

writeAtlas(path.join(MODELS, "palette.png"), [
  PALETTE.map((c) => c.base),
  PALETTE.map((c) => c.glow)
]);
writeAtlas(path.join(MODELS, "palette-emissive.png"), [
  PALETTE.map(() => "#000000"),
  PALETTE.map((c) => c.glow)
]);

function writeIcon(defIdx, file) {
  const SIZE = 112, PAD = 7;
  const els = new Set(elemsFor(defIdx, 0, 0, 0).map((e) => e.a + "," + e.b + "," + e.d));
  const outline = outlinePts(defIdx, 0);
  const xs = outline.map((p) => p.x), zs = outline.map((p) => p.z);
  const minx = Math.min(...xs), maxx = Math.max(...xs), minz = Math.min(...zs), maxz = Math.max(...zs);
  const span = Math.max(maxx - minx, maxz - minz);
  const sc = span / (SIZE - 2 * PAD);
  const ox = (minx + maxx) / 2, oz = (minz + maxz) / 2;
  const rgba = Buffer.alloc(SIZE * SIZE * 4);
  for (let py = 0; py < SIZE; py++)
    for (let px = 0; px < SIZE; px++) {
      let hits = 0;
      for (const [sx, sy] of SS4) {
        const x = ox + (px + sx - SIZE / 2) * sc;
        const z = oz - (py + sy - SIZE / 2) * sc;
        const c = triAt(x, z);
        if (els.has(c.a + "," + c.b + "," + c.d)) hits++;
      }
      if (!hits) continue;
      const o = (py * SIZE + px) * 4;
      rgba[o] = 255; rgba[o + 1] = 255; rgba[o + 2] = 255;
      rgba[o + 3] = Math.round((hits / 4) * 255);
    }
  writePng(file, SIZE, SIZE, rgba);
}

const paletteTs = `// AUTO-GENERATED by scripts/gen-assets.ts -- do not edit by hand
import { Color4 } from './raw/shims/math.ts'

type Color = ReturnType<typeof Color4.create>

export interface BrickColor {
  name: string
  base: string
  glow: string
}

export const COLORS: BrickColor[] = ${JSON.stringify(PALETTE, null, 2)}

export function hexToColor4(hex: string, alpha = 1): Color {
  const v = parseInt(hex.slice(1), 16)
  return Color4.create(((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255, alpha)
}
`;
fs.writeFileSync(path.join(__dirname, "..", "src", "palette.ts"), paletteTs);

for (const f of fs.readdirSync(MODELS))
  if (/^brick-\d+\.glb$/.test(f)) fs.unlinkSync(path.join(MODELS, f));

SHAPES.forEach((shape, s) => {
  PALETTE.forEach((_, c) => {
    const mesh = brickMesh(s, cellUV(c, 0), cellUV(c, 1));
    fs.writeFileSync(
      path.join(MODELS, `brick-${s}-${c}.glb`),
      buildGlb([{ ...mesh, material: 0 }], [texturedMaterial("hexbrick", 0.15, 0.35)], "brick", true)
    );
  });
  const ghostGeom = brickMesh(s, [0, 0], [0, 0]);
  fs.writeFileSync(
    path.join(MODELS, `ghost-${s}.glb`),
    buildGlb([{ ...ghostGeom, material: 0 }], [ghostMaterial(0xffffff, 0.45, "ghost")], "ghost")
  );
  writeIcon(s, path.join(ICONS, `icon-${s}.png`));
  console.log(`shape ${s} (${shape.name}): ${PALETTE.length} colors, ${ghostGeom.idx.length / 3} tris`);
});

writeFloorTile();
writeHudSprites();
const { disc } = boardMesh();
fs.writeFileSync(
  path.join(MODELS, "board.glb"),
  buildGlb([{ ...disc, material: 0 }], [texturedMaterial("hexfloor", 0, 0.8)], "board",
    { images: ["hexfloor.png", "hexfloor-emissive.png"], wrap: 10497 })
);
console.log(`board: ${disc.idx.length / 3} tris, grid in hexfloor.png`);
console.log(`palette: ${PALETTE.map((c) => c.name).join(", ")}`);
