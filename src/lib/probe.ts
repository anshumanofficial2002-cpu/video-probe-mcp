/** Run ffprobe and turn its JSON into a clean, creator-friendly summary. */
import { open, stat } from "node:fs/promises";
import path from "node:path";
import { runOrThrow } from "./ffmpeg.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
export type RawProbe = {
  format?: Record<string, any>;
  streams?: Record<string, any>[];
  chapters?: Record<string, any>[];
};

export async function ffprobeJson(file: string, extraArgs: string[] = []): Promise<RawProbe> {
  const res = await runOrThrow(
    "ffprobe",
    ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", "-show_chapters", ...extraArgs, file],
    { timeoutMs: 120000 },
  );
  try {
    return JSON.parse(res.stdout) as RawProbe;
  } catch {
    throw new Error("ffprobe returned output that is not valid JSON.");
  }
}

export interface VideoStreamSummary {
  index: number;
  codec: string;
  codec_long: string | null;
  profile: string | null;
  width: number;
  height: number;
  /** Width/height after applying rotation metadata (what viewers see). */
  display_width: number;
  display_height: number;
  rotation: number;
  orientation: "vertical" | "horizontal" | "square";
  aspect_ratio: string;
  aspect_label: string;
  fps: number | null;
  fps_label: string | null;
  variable_frame_rate: boolean;
  pixel_format: string | null;
  bit_depth: number | null;
  chroma_subsampling: string | null;
  color_space: string | null;
  color_primaries: string | null;
  color_transfer: string | null;
  color_range: string | null;
  hdr: "SDR" | "HDR10 (PQ)" | "HLG" | "Dolby Vision";
  bitrate_bps: number | null;
  frame_count: number | null;
  is_attached_picture: boolean;
}

export interface AudioStreamSummary {
  index: number;
  codec: string;
  profile: string | null;
  sample_rate: number | null;
  channels: number | null;
  channel_layout: string | null;
  bitrate_bps: number | null;
  language: string | null;
}

export interface MediaSummary {
  file: string;
  file_name: string;
  container: string;
  container_long: string | null;
  size_bytes: number;
  duration_seconds: number | null;
  overall_bitrate_bps: number | null;
  video: VideoStreamSummary[];
  audio: AudioStreamSummary[];
  subtitles: { index: number; codec: string; language: string | null }[];
  data_streams: number;
  chapters: number;
  metadata: {
    creation_time: string | null;
    encoder: string | null;
    device_make: string | null;
    device_model: string | null;
    software: string | null;
    title: string | null;
  };
  has_gps_location: boolean;
  gps_location?: string | null;
  web_optimized: boolean | null;
  warnings: string[];
}

export function parseRate(rate: unknown): number | null {
  if (typeof rate !== "string" || !rate.includes("/")) {
    const n = Number(rate);
    return Number.isFinite(n) && n > 0 ? n : null;
  }
  const [a, b] = rate.split("/").map(Number);
  if (!b || !Number.isFinite(a) || a === 0) return null;
  return a / b;
}

export function fpsLabel(fps: number | null): string | null {
  if (fps === null) return null;
  const known: [number, string][] = [
    [23.976, "23.976"], [24, "24"], [25, "25"], [29.97, "29.97"], [30, "30"],
    [48, "48"], [50, "50"], [59.94, "59.94"], [60, "60"], [119.88, "119.88"], [120, "120"],
  ];
  for (const [v, label] of known) if (Math.abs(fps - v) < 0.01) return label;
  return fps.toFixed(3).replace(/\.?0+$/, "");
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

const COMMON_ASPECTS: [number, string][] = [
  [9 / 16, "9:16"], [16 / 9, "16:9"], [1, "1:1"], [4 / 5, "4:5"], [5 / 4, "5:4"],
  [4 / 3, "4:3"], [3 / 4, "3:4"], [2 / 3, "2:3"], [3 / 2, "3:2"], [21 / 9, "21:9"],
  [2.39, "2.39:1 (scope)"], [1.85, "1.85:1 (flat)"], [2, "2:1"], [1 / 2, "1:2"],
];

export function aspectInfo(w: number, h: number): { ratio: string; label: string } {
  if (!w || !h) return { ratio: "unknown", label: "unknown" };
  const g = gcd(w, h);
  const ratio = `${w / g}:${h / g}`;
  const r = w / h;
  let best = COMMON_ASPECTS[0];
  for (const c of COMMON_ASPECTS) if (Math.abs(c[0] - r) < Math.abs(best[0] - r)) best = c;
  const label = Math.abs(best[0] - r) / best[0] < 0.02 ? best[1] : `${r.toFixed(3)}:1`;
  return { ratio, label };
}

function bitDepth(pixFmt: string | null, raw: unknown): number | null {
  const n = Number(raw);
  if (Number.isFinite(n) && n > 0) return n;
  if (!pixFmt) return null;
  const m = pixFmt.match(/p(\d{2})(le|be)?$/);
  if (m) return Number(m[1]);
  return 8;
}

function chroma(pixFmt: string | null): string | null {
  if (!pixFmt) return null;
  if (pixFmt.includes("420") || pixFmt.startsWith("nv12") || pixFmt.startsWith("p010")) return "4:2:0";
  if (pixFmt.includes("422")) return "4:2:2";
  if (pixFmt.includes("444") || pixFmt.startsWith("rgb") || pixFmt.startsWith("gbr")) return "4:4:4";
  return null;
}

function rotationOf(stream: Record<string, any>): number {
  const sd = (stream.side_data_list ?? []) as Record<string, any>[];
  for (const d of sd) {
    if (typeof d.rotation === "number") return normalizeRotation(d.rotation);
  }
  const tag = stream.tags?.rotate;
  if (tag !== undefined) return normalizeRotation(Number(tag));
  return 0;
}

function normalizeRotation(r: number): number {
  if (!Number.isFinite(r)) return 0;
  let v = Math.round(r) % 360;
  if (v < 0) v += 360;
  return v;
}

function hdrOf(stream: Record<string, any>): VideoStreamSummary["hdr"] {
  const sd = (stream.side_data_list ?? []) as Record<string, any>[];
  if (sd.some((d) => String(d.side_data_type ?? "").toLowerCase().includes("dovi"))) return "Dolby Vision";
  if (stream.color_transfer === "smpte2084") return "HDR10 (PQ)";
  if (stream.color_transfer === "arib-std-b67") return "HLG";
  return "SDR";
}

function num(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function tag(tags: Record<string, any> | undefined, ...keys: string[]): string | null {
  if (!tags) return null;
  const lower = Object.fromEntries(Object.entries(tags).map(([k, v]) => [k.toLowerCase(), v]));
  for (const k of keys) {
    const v = lower[k.toLowerCase()];
    if (v !== undefined && v !== "") return String(v);
  }
  return null;
}

/**
 * Check whether an MP4/MOV has its `moov` atom before `mdat` ("fast start").
 * Players and upload pipelines can start processing without reading the whole file.
 * Returns null for non-ISO-BMFF files.
 */
export async function isFastStart(file: string): Promise<boolean | null> {
  const ext = path.extname(file).toLowerCase();
  if (![".mp4", ".m4v", ".mov", ".m4a", ".3gp"].includes(ext)) return null;
  const fh = await open(file, "r");
  try {
    const { size } = await fh.stat();
    let pos = 0;
    const header = Buffer.alloc(16);
    for (let i = 0; i < 64 && pos + 8 <= size; i++) {
      const { bytesRead } = await fh.read(header, 0, 16, pos);
      if (bytesRead < 8) break;
      let boxSize = header.readUInt32BE(0);
      const type = header.toString("latin1", 4, 8);
      if (boxSize === 1) {
        if (bytesRead < 16) break;
        boxSize = Number(header.readBigUInt64BE(8));
      } else if (boxSize === 0) {
        boxSize = size - pos;
      }
      if (type === "moov") return true;
      if (type === "mdat") return false;
      if (boxSize < 8) break;
      pos += boxSize;
    }
    return null;
  } finally {
    await fh.close();
  }
}

export async function summarize(file: string, opts: { includeLocation?: boolean } = {}): Promise<MediaSummary> {
  const raw = await ffprobeJson(file);
  const fmt = raw.format ?? {};
  const streams = raw.streams ?? [];
  const warnings: string[] = [];
  const size = num(fmt.size) ?? (await stat(file)).size;

  const video: VideoStreamSummary[] = streams
    .filter((s) => s.codec_type === "video")
    .map((s) => {
      const width = Number(s.width) || 0;
      const height = Number(s.height) || 0;
      const rotation = rotationOf(s);
      const swap = rotation === 90 || rotation === 270;
      const dw = swap ? height : width;
      const dh = swap ? width : height;
      const avg = parseRate(s.avg_frame_rate);
      const rFps = parseRate(s.r_frame_rate);
      const fps = avg ?? rFps;
      const vfr = avg !== null && rFps !== null && Math.abs(avg - rFps) / rFps > 0.01;
      const pix = s.pix_fmt ?? null;
      const asp = aspectInfo(dw, dh);
      return {
        index: s.index,
        codec: s.codec_name ?? "unknown",
        codec_long: s.codec_long_name ?? null,
        profile: s.profile ?? null,
        width,
        height,
        display_width: dw,
        display_height: dh,
        rotation,
        orientation: dw > dh ? "horizontal" : dw < dh ? "vertical" : "square",
        aspect_ratio: asp.ratio,
        aspect_label: asp.label,
        fps,
        fps_label: fpsLabel(fps),
        variable_frame_rate: vfr,
        pixel_format: pix,
        bit_depth: bitDepth(pix, s.bits_per_raw_sample),
        chroma_subsampling: chroma(pix),
        color_space: s.color_space ?? null,
        color_primaries: s.color_primaries ?? null,
        color_transfer: s.color_transfer ?? null,
        color_range: s.color_range ?? null,
        hdr: hdrOf(s),
        bitrate_bps: num(s.bit_rate),
        frame_count: num(s.nb_frames),
        is_attached_picture: s.disposition?.attached_pic === 1,
      } satisfies VideoStreamSummary;
    });

  const audio: AudioStreamSummary[] = streams
    .filter((s) => s.codec_type === "audio")
    .map((s) => ({
      index: s.index,
      codec: s.codec_name ?? "unknown",
      profile: s.profile ?? null,
      sample_rate: num(s.sample_rate),
      channels: num(s.channels),
      channel_layout: s.channel_layout ?? null,
      bitrate_bps: num(s.bit_rate),
      language: tag(s.tags, "language"),
    }));

  const subtitles = streams
    .filter((s) => s.codec_type === "subtitle")
    .map((s) => ({ index: s.index, codec: s.codec_name ?? "unknown", language: tag(s.tags, "language") }));

  const location = tag(fmt.tags, "location", "com.apple.quicktime.location.iso6709", "location-eng");
  const duration = num(fmt.duration);

  const realVideo = video.filter((v) => !v.is_attached_picture);
  if (realVideo.some((v) => v.variable_frame_rate)) {
    warnings.push("Variable frame rate detected (typical of phone and screen recordings). Some editors drift audio out of sync; conform to a constant frame rate before editing.");
  }
  if (realVideo.some((v) => v.hdr !== "SDR")) {
    warnings.push("HDR video. Platforms and editors may show it washed out or over-bright unless it is tone-mapped or exported as SDR.");
  }
  if (location) warnings.push("File contains GPS location metadata. Strip it before publishing (ffmpeg -map_metadata -1, or conform_for_platform with strip_metadata).");
  if (realVideo.length === 0 && audio.length > 0) warnings.push("Audio-only file.");

  const fast = await isFastStart(file).catch(() => null);
  if (fast === false) warnings.push("Not web-optimized: the moov atom is at the end of the file. Re-mux with -movflags +faststart so uploads and previews start faster.");

  const summary: MediaSummary = {
    file,
    file_name: path.basename(file),
    container: fmt.format_name ?? "unknown",
    container_long: fmt.format_long_name ?? null,
    size_bytes: size,
    duration_seconds: duration,
    overall_bitrate_bps: num(fmt.bit_rate),
    video: realVideo,
    audio,
    subtitles,
    data_streams: streams.filter((s) => s.codec_type === "data").length,
    chapters: (raw.chapters ?? []).length,
    metadata: {
      creation_time: tag(fmt.tags, "creation_time", "com.apple.quicktime.creationdate"),
      encoder: tag(fmt.tags, "encoder", "com.apple.quicktime.software"),
      device_make: tag(fmt.tags, "com.apple.quicktime.make", "make"),
      device_model: tag(fmt.tags, "com.apple.quicktime.model", "model"),
      software: tag(fmt.tags, "com.apple.quicktime.software", "software"),
      title: tag(fmt.tags, "title"),
    },
    has_gps_location: Boolean(location),
    web_optimized: fast,
    warnings,
  };
  if (opts.includeLocation) summary.gps_location = location;
  return summary;
}

export function describe(m: MediaSummary): string {
  const lines: string[] = [];
  const mb = (m.size_bytes / 1024 / 1024).toFixed(1);
  lines.push(`**${m.file_name}** — ${m.container_long ?? m.container}, ${mb} MB${m.duration_seconds ? `, ${m.duration_seconds.toFixed(2)}s` : ""}`);
  for (const v of m.video) {
    lines.push(
      `Video: ${v.codec}${v.profile ? ` (${v.profile})` : ""}, ${v.display_width}x${v.display_height} ${v.orientation} ${v.aspect_label}, ` +
        `${v.fps_label ?? "?"} fps${v.variable_frame_rate ? " (VFR)" : ""}, ${v.pixel_format ?? "?"} ${v.bit_depth ?? "?"}-bit, ${v.hdr}` +
        (v.bitrate_bps ? `, ${(v.bitrate_bps / 1e6).toFixed(1)} Mbps` : "") +
        (v.rotation ? `, rotated ${v.rotation}°` : ""),
    );
  }
  for (const a of m.audio) {
    lines.push(
      `Audio: ${a.codec}, ${a.sample_rate ?? "?"} Hz, ${a.channel_layout ?? `${a.channels ?? "?"} ch`}` +
        (a.bitrate_bps ? `, ${Math.round(a.bitrate_bps / 1000)} kbps` : ""),
    );
  }
  if (m.audio.length === 0 && m.video.length) lines.push("Audio: none");
  if (m.metadata.device_model) lines.push(`Recorded on: ${[m.metadata.device_make, m.metadata.device_model].filter(Boolean).join(" ")}`);
  if (m.warnings.length) lines.push("", "Warnings:", ...m.warnings.map((w) => `- ${w}`));
  return lines.join("\n");
}
