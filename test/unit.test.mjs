import { test } from "node:test";
import assert from "node:assert/strict";
import { aspectInfo, fpsLabel, parseRate } from "../dist/lib/probe.js";
import { parseTimestamp, formatTimestamp, shellQuote } from "../dist/lib/ffmpeg.js";
import { aspectMatches, checkAgainst, PLATFORMS } from "../dist/lib/specs.js";

test("parseRate handles fractions and junk", () => {
  assert.equal(parseRate("30/1"), 30);
  assert.ok(Math.abs(parseRate("30000/1001") - 29.97) < 0.001);
  assert.equal(parseRate("0/0"), null);
  assert.equal(parseRate(undefined), null);
});

test("fpsLabel names broadcast rates", () => {
  assert.equal(fpsLabel(24000 / 1001), "23.976");
  assert.equal(fpsLabel(60000 / 1001), "59.94");
  assert.equal(fpsLabel(25), "25");
});

test("aspectInfo snaps to common ratios", () => {
  assert.equal(aspectInfo(1080, 1920).label, "9:16");
  assert.equal(aspectInfo(1920, 1080).label, "16:9");
  assert.equal(aspectInfo(1080, 1350).label, "4:5");
  assert.equal(aspectInfo(3840, 1608).label, "2.39:1 (scope)");
});

test("timestamps parse and format", () => {
  assert.equal(parseTimestamp("1:02"), 62);
  assert.equal(parseTimestamp("00:01:02.5"), 62.5);
  assert.equal(parseTimestamp("12.25"), 12.25);
  assert.equal(parseTimestamp("50%", 10), 5);
  assert.throws(() => parseTimestamp("abc"));
  assert.equal(formatTimestamp(3723.456), "01:02:03.456");
});

test("shellQuote leaves safe args and quotes the rest", () => {
  assert.equal(shellQuote("in.mp4"), "in.mp4");
  assert.equal(shellQuote("my clip.mp4"), "'my clip.mp4'");
  assert.equal(shellQuote("it's.mp4"), "'it'\\''s.mp4'");
});

test("aspectMatches tolerates rounding", () => {
  assert.ok(aspectMatches(1080, 1920, { w: 9, h: 16 }));
  assert.ok(aspectMatches(1088, 1920, { w: 9, h: 16 }));
  assert.ok(!aspectMatches(1920, 1080, { w: 9, h: 16 }));
});

function fakeSummary(overrides = {}) {
  return {
    file: "/x/clip.mp4", file_name: "clip.mp4", container: "mov,mp4,m4a,3gp,3g2,mj2", container_long: null,
    size_bytes: 40 * 1024 * 1024, duration_seconds: 30, overall_bitrate_bps: 10e6,
    video: [{
      index: 0, codec: "h264", codec_long: null, profile: "High", width: 1080, height: 1920, display_width: 1080, display_height: 1920,
      rotation: 0, orientation: "vertical", aspect_ratio: "9:16", aspect_label: "9:16", fps: 30, fps_label: "30", variable_frame_rate: false,
      pixel_format: "yuv420p", bit_depth: 8, chroma_subsampling: "4:2:0", color_space: "bt709", color_primaries: "bt709", color_transfer: "bt709",
      color_range: "tv", hdr: "SDR", bitrate_bps: 9.5e6, frame_count: 900, is_attached_picture: false,
    }],
    audio: [{ index: 1, codec: "aac", profile: "LC", sample_rate: 48000, channels: 2, channel_layout: "stereo", bitrate_bps: 192000, language: null }],
    subtitles: [], data_streams: 0, chapters: 0,
    metadata: { creation_time: null, encoder: null, device_make: null, device_model: null, software: null, title: null },
    has_gps_location: false, web_optimized: true, warnings: [],
    ...overrides,
  };
}

test("a clean vertical export passes Reels", () => {
  const { verdict, results } = checkAgainst(fakeSummary(), PLATFORMS.instagram_reels);
  assert.equal(verdict, "pass", JSON.stringify(results.filter((r) => r.status !== "pass"), null, 2));
});

test("horizontal 4-minute HDR file with GPS warns on Reels", () => {
  const s = fakeSummary({ duration_seconds: 240, has_gps_location: true });
  Object.assign(s.video[0], { display_width: 1920, display_height: 1080, aspect_label: "16:9", hdr: "HLG", color_transfer: "arib-std-b67" });
  const { verdict, results } = checkAgainst(s, PLATFORMS.instagram_reels);
  assert.equal(verdict, "warn");
  const warned = results.filter((r) => r.status === "warn").map((r) => r.check);
  for (const c of ["Aspect ratio", "Duration", "Dynamic range", "Location metadata"]) assert.ok(warned.includes(c), c);
});

test("ProRes fails a social upload check", () => {
  const s = fakeSummary();
  s.video[0].codec = "prores";
  assert.equal(checkAgainst(s, PLATFORMS.tiktok).verdict, "fail");
});
