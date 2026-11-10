/**
 * Upload guidelines per platform, and a checker that grades a probed file against them.
 *
 * These are practical targets, not official guarantees. Platforms change limits often
 * and roll them out per account and region, so length and size limits are reported as
 * warnings rather than hard failures. Every field can be overridden with custom_spec.
 */
import type { MediaSummary } from "./probe.js";

export interface Aspect {
  w: number;
  h: number;
}

export interface PlatformSpec {
  id: string;
  name: string;
  /** Preferred aspect ratio. */
  aspect: Aspect;
  /** Other ratios the platform displays without heavy cropping. */
  alternative_aspects: Aspect[];
  /** Export size we recommend for the preferred aspect. */
  resolution: { width: number; height: number };
  /** Shortest side below this looks soft after the platform re-encodes. */
  min_short_side: number;
  min_duration_seconds: number;
  max_duration_seconds: number;
  max_file_size_bytes: number;
  fps_range: [number, number];
  video_codecs: string[];
  audio_codecs: string[];
  containers: string[];
  /** Above this, the platform's re-encode throws most of the extra quality away. */
  max_useful_bitrate_mbps: number;
  notes: string[];
}

const GB = 1024 ** 3;
const MB = 1024 ** 2;

export const SPECS_REVIEWED = "2026-11";

export const PLATFORMS: Record<string, PlatformSpec> = {
  instagram_reels: {
    id: "instagram_reels",
    name: "Instagram Reels",
    aspect: { w: 9, h: 16 },
    alternative_aspects: [],
    resolution: { width: 1080, height: 1920 },
    min_short_side: 720,
    min_duration_seconds: 3,
    max_duration_seconds: 180,
    max_file_size_bytes: 4 * GB,
    fps_range: [23, 60],
    video_codecs: ["h264", "hevc"],
    audio_codecs: ["aac"],
    containers: ["mp4", "mov"],
    max_useful_bitrate_mbps: 25,
    notes: [
      "3 minutes is widely available; some accounts can post longer Reels. Check the length selector in your Reels camera.",
      "Keep text and faces out of the bottom ~20% and top ~14% where the UI overlays sit.",
    ],
  },
  instagram_feed: {
    id: "instagram_feed",
    name: "Instagram feed video",
    aspect: { w: 4, h: 5 },
    alternative_aspects: [{ w: 1, h: 1 }, { w: 9, h: 16 }, { w: 16, h: 9 }],
    resolution: { width: 1080, height: 1350 },
    min_short_side: 720,
    min_duration_seconds: 3,
    max_duration_seconds: 3600,
    max_file_size_bytes: 4 * GB,
    fps_range: [23, 60],
    video_codecs: ["h264", "hevc"],
    audio_codecs: ["aac"],
    containers: ["mp4", "mov"],
    max_useful_bitrate_mbps: 25,
    notes: ["4:5 takes up the most screen in the feed. 9:16 is cropped to 4:5 in the grid preview."],
  },
  tiktok: {
    id: "tiktok",
    name: "TikTok",
    aspect: { w: 9, h: 16 },
    alternative_aspects: [],
    resolution: { width: 1080, height: 1920 },
    min_short_side: 720,
    min_duration_seconds: 3,
    max_duration_seconds: 3600,
    max_file_size_bytes: 500 * MB,
    fps_range: [23, 60],
    video_codecs: ["h264", "hevc"],
    audio_codecs: ["aac"],
    containers: ["mp4", "mov"],
    max_useful_bitrate_mbps: 25,
    notes: [
      "Uploads can run up to 60 minutes on many accounts; in-app recording is capped lower. Rollout varies by region.",
      "~500 MB is the common mobile upload limit; the web uploader accepts larger files.",
      "1:1 and 16:9 are accepted but shown letterboxed.",
    ],
  },
  youtube_shorts: {
    id: "youtube_shorts",
    name: "YouTube Shorts",
    aspect: { w: 9, h: 16 },
    alternative_aspects: [{ w: 1, h: 1 }],
    resolution: { width: 1080, height: 1920 },
    min_short_side: 720,
    min_duration_seconds: 1,
    max_duration_seconds: 180,
    max_file_size_bytes: 256 * GB,
    fps_range: [23, 60],
    video_codecs: ["h264", "hevc", "vp9", "av1"],
    audio_codecs: ["aac", "opus"],
    containers: ["mp4", "mov", "webm"],
    max_useful_bitrate_mbps: 30,
    notes: ["Square or vertical, up to 3 minutes. Longer vertical uploads become regular videos."],
  },
  youtube: {
    id: "youtube",
    name: "YouTube (long-form)",
    aspect: { w: 16, h: 9 },
    alternative_aspects: [],
    resolution: { width: 1920, height: 1080 },
    min_short_side: 720,
    min_duration_seconds: 1,
    max_duration_seconds: 12 * 3600,
    max_file_size_bytes: 256 * GB,
    fps_range: [23, 60],
    video_codecs: ["h264", "hevc", "vp9", "av1", "prores"],
    audio_codecs: ["aac", "opus", "pcm_s16le", "pcm_s24le"],
    containers: ["mp4", "mov", "webm", "mkv"],
    max_useful_bitrate_mbps: 80,
    notes: [
      "Unverified accounts are limited to 15 minutes per upload.",
      "Uploading at 1440p or 4K gets the higher-quality VP9/AV1 encode even for 1080p viewers.",
    ],
  },
  x: {
    id: "x",
    name: "X (Twitter)",
    aspect: { w: 16, h: 9 },
    alternative_aspects: [{ w: 1, h: 1 }, { w: 9, h: 16 }, { w: 4, h: 5 }],
    resolution: { width: 1920, height: 1080 },
    min_short_side: 720,
    min_duration_seconds: 0.5,
    max_duration_seconds: 140,
    max_file_size_bytes: 512 * MB,
    fps_range: [23, 60],
    video_codecs: ["h264"],
    audio_codecs: ["aac"],
    containers: ["mp4", "mov"],
    max_useful_bitrate_mbps: 25,
    notes: ["2:20 for standard accounts; Premium subscribers can upload much longer videos."],
  },
  linkedin: {
    id: "linkedin",
    name: "LinkedIn",
    aspect: { w: 1, h: 1 },
    alternative_aspects: [{ w: 16, h: 9 }, { w: 9, h: 16 }, { w: 4, h: 5 }],
    resolution: { width: 1080, height: 1080 },
    min_short_side: 720,
    min_duration_seconds: 3,
    max_duration_seconds: 900,
    max_file_size_bytes: 5 * GB,
    fps_range: [10, 60],
    video_codecs: ["h264", "hevc"],
    audio_codecs: ["aac"],
    containers: ["mp4", "mov"],
    max_useful_bitrate_mbps: 25,
    notes: ["Square and 4:5 hold the most feed space on mobile. Burn in captions — most people watch muted."],
  },
};

export type Status = "pass" | "warn" | "fail" | "info";

export interface CheckResult {
  check: string;
  status: Status;
  actual: string;
  expected: string;
  fix?: string;
}

export function aspectMatches(w: number, h: number, a: Aspect, tolerance = 0.02): boolean {
  if (!w || !h) return false;
  const r = w / h;
  const t = a.w / a.h;
  return Math.abs(r - t) / t <= tolerance;
}

function containerShort(m: MediaSummary): string {
  const ext = m.file_name.split(".").pop()?.toLowerCase() ?? "";
  if (ext) return ext;
  return m.container.split(",")[0];
}

export function mergeSpec(base: PlatformSpec, custom?: Partial<PlatformSpec>): PlatformSpec {
  if (!custom) return base;
  return { ...base, ...custom, notes: [...base.notes, ...(custom.notes ?? [])] } as PlatformSpec;
}

export function checkAgainst(m: MediaSummary, spec: PlatformSpec): { results: CheckResult[]; verdict: Status } {
  const r: CheckResult[] = [];
  const v = m.video[0];
  const a = m.audio[0];
  const fmtA = (x: Aspect) => `${x.w}:${x.h}`;

  // container
  const c = containerShort(m);
  r.push({
    check: "Container",
    status: spec.containers.includes(c) ? "pass" : "warn",
    actual: c,
    expected: spec.containers.join(" / "),
    fix: spec.containers.includes(c) ? undefined : "Re-wrap or re-encode to .mp4.",
  });

  if (!v) {
    r.push({ check: "Video stream", status: "fail", actual: "none", expected: "1 video stream" });
    return { results: r, verdict: "fail" };
  }

  // codec
  const codecOk = spec.video_codecs.includes(v.codec);
  r.push({
    check: "Video codec",
    status: codecOk ? (v.codec === "h264" || spec.video_codecs[0] === v.codec ? "pass" : "info") : v.codec === "prores" || v.codec === "dnxhd" ? "fail" : "warn",
    actual: v.codec,
    expected: spec.video_codecs.join(" / "),
    fix: codecOk ? undefined : "Encode to H.264 (libx264), yuv420p.",
  });

  // pixel format / bit depth
  const is8bit420 = v.bit_depth === 8 && v.chroma_subsampling === "4:2:0";
  r.push({
    check: "Pixel format",
    status: is8bit420 ? "pass" : "warn",
    actual: `${v.pixel_format ?? "?"} (${v.bit_depth ?? "?"}-bit ${v.chroma_subsampling ?? "?"})`,
    expected: "yuv420p (8-bit 4:2:0) is the safest",
    fix: is8bit420 ? undefined : "Add -pix_fmt yuv420p when encoding.",
  });

  // HDR
  if (v.hdr !== "SDR") {
    r.push({
      check: "Dynamic range",
      status: "warn",
      actual: v.hdr,
      expected: "SDR (Rec.709) unless you have checked the HDR upload on a phone",
      fix: "Tone-map to SDR in your editor, or export with an SDR color space.",
    });
  }

  // aspect
  const dw = v.display_width;
  const dh = v.display_height;
  const primary = aspectMatches(dw, dh, spec.aspect);
  const alt = spec.alternative_aspects.find((x) => aspectMatches(dw, dh, x));
  r.push({
    check: "Aspect ratio",
    status: primary ? "pass" : alt ? "info" : "warn",
    actual: `${v.aspect_label} (${dw}x${dh})`,
    expected: `${fmtA(spec.aspect)} preferred${spec.alternative_aspects.length ? `, also accepted: ${spec.alternative_aspects.map(fmtA).join(", ")}` : ""}`,
    fix: primary ? undefined : alt ? `Accepted, but ${fmtA(spec.aspect)} fills more of the screen.` : `Will be cropped or letterboxed. Reframe to ${fmtA(spec.aspect)} (conform_for_platform with fit: crop, pad or blur).`,
  });

  // resolution
  const short = Math.min(dw, dh);
  const target = spec.resolution;
  const resStatus: Status = short < spec.min_short_side ? "warn" : primary && dw === target.width && dh === target.height ? "pass" : short >= Math.min(target.width, target.height) ? "pass" : "info";
  r.push({
    check: "Resolution",
    status: resStatus,
    actual: `${dw}x${dh}`,
    expected: `${target.width}x${target.height} recommended, shortest side ≥ ${spec.min_short_side}`,
    fix: short < spec.min_short_side ? "Low resolution — the platform's re-encode will look soft. Export at least 1080 on the short side." : undefined,
  });

  // fps
  if (v.fps !== null) {
    const [lo, hi] = spec.fps_range;
    const ok = v.fps >= lo - 0.1 && v.fps <= hi + 0.1;
    r.push({
      check: "Frame rate",
      status: ok ? (v.variable_frame_rate ? "warn" : "pass") : "warn",
      actual: `${v.fps_label} fps${v.variable_frame_rate ? " (variable)" : ""}`,
      expected: `${lo}–${hi} fps, constant`,
      fix: !ok ? `Conform to ${v.fps > hi ? hi : 30} fps.` : v.variable_frame_rate ? "Conform to a constant frame rate (e.g. -fps_mode cfr or an fps filter)." : undefined,
    });
  }

  // duration
  const d = m.duration_seconds;
  if (d !== null) {
    const ok = d >= spec.min_duration_seconds && d <= spec.max_duration_seconds;
    r.push({
      check: "Duration",
      status: ok ? "pass" : "warn",
      actual: `${d.toFixed(2)}s`,
      expected: `${spec.min_duration_seconds}s – ${spec.max_duration_seconds}s`,
      fix: ok ? undefined : d > spec.max_duration_seconds ? `Longer than the usual limit (${spec.max_duration_seconds}s). Trim it or check your account's limit.` : "Shorter than the minimum.",
    });
  }

  // size
  const sizeOk = m.size_bytes <= spec.max_file_size_bytes;
  r.push({
    check: "File size",
    status: sizeOk ? "pass" : "warn",
    actual: `${(m.size_bytes / MB).toFixed(1)} MB`,
    expected: `≤ ${(spec.max_file_size_bytes / MB).toFixed(0)} MB`,
    fix: sizeOk ? undefined : "Re-encode with a higher CRF (e.g. 20–23) or lower bitrate.",
  });

  // bitrate
  const br = v.bitrate_bps ?? m.overall_bitrate_bps;
  if (br) {
    const mbps = br / 1e6;
    const tooLow = short >= 1080 ? mbps < 4 : mbps < 2;
    const tooHigh = mbps > spec.max_useful_bitrate_mbps * 2;
    r.push({
      check: "Bitrate",
      status: tooLow ? "warn" : tooHigh ? "info" : "pass",
      actual: `${mbps.toFixed(1)} Mbps`,
      expected: `~8–${spec.max_useful_bitrate_mbps} Mbps for 1080p`,
      fix: tooLow ? "Low bitrate: expect blocky gradients after the platform re-encodes. Export at CRF 18 or 10+ Mbps." : tooHigh ? "Much higher than the platform keeps. Fine, but a smaller file uploads faster." : undefined,
    });
  }

  // audio
  if (!a) {
    r.push({ check: "Audio", status: "info", actual: "no audio track", expected: `${spec.audio_codecs[0]} stereo, 48 kHz`, fix: "Fine for silent posts; add a track if you want the platform's music/voice features to work normally." });
  } else {
    const codecOkA = spec.audio_codecs.includes(a.codec);
    const srOk = a.sample_rate === 48000 || a.sample_rate === 44100;
    const chOk = (a.channels ?? 2) <= 2;
    r.push({
      check: "Audio",
      status: codecOkA && srOk && chOk ? "pass" : "warn",
      actual: `${a.codec}, ${a.sample_rate ?? "?"} Hz, ${a.channel_layout ?? `${a.channels} ch`}`,
      expected: `${spec.audio_codecs.join("/")}, 44.1 or 48 kHz, stereo`,
      fix: codecOkA && srOk && chOk ? undefined : "Encode audio as AAC, 48 kHz, stereo (-c:a aac -ar 48000 -ac 2).",
    });
  }

  // fast start
  if (m.web_optimized === false) {
    r.push({ check: "Fast start", status: "warn", actual: "moov atom at end", expected: "moov before mdat", fix: "Re-mux: ffmpeg -i in.mp4 -c copy -movflags +faststart out.mp4" });
  } else if (m.web_optimized === true) {
    r.push({ check: "Fast start", status: "pass", actual: "web-optimized", expected: "moov before mdat" });
  }

  // privacy
  if (m.has_gps_location) {
    r.push({ check: "Location metadata", status: "warn", actual: "GPS coordinates embedded", expected: "none", fix: "Strip metadata: ffmpeg -i in.mp4 -map_metadata -1 -c copy out.mp4" });
  }

  const verdict: Status = r.some((x) => x.status === "fail") ? "fail" : r.some((x) => x.status === "warn") ? "warn" : "pass";
  return { results: r, verdict };
}
