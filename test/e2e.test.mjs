// End-to-end: start the built server over stdio and call its tools like an MCP client would.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, rmSync } from "node:fs";
import path from "node:path";
import { connect, fixture, hasFfmpeg, jsonOf, textOf, TMP } from "./helpers.mjs";

const skip = !hasFfmpeg() && "ffmpeg not installed";
let client;
let horizontal;
let vertical;

before(async () => {
  if (skip) return;
  horizontal = fixture("horizontal.mp4", [
    "-f", "lavfi", "-i", "testsrc2=size=1920x1080:rate=30:duration=4",
    "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000:duration=4",
    "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest",
  ]);
  vertical = fixture("vertical faststart.mp4", [
    "-f", "lavfi", "-i", "testsrc2=size=1080x1920:rate=30:duration=4",
    "-f", "lavfi", "-i", "sine=frequency=220:sample_rate=48000:duration=4",
    "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-c:a", "aac", "-movflags", "+faststart", "-shortest",
  ]);
  client = await connect();
});

after(async () => {
  await client?.close();
});

test("lists all tools", { skip }, async () => {
  const { tools } = await client.listTools();
  const names = tools.map((t) => t.name).sort();
  assert.deepEqual(names, ["check_platform_spec", "check_setup", "compare_media", "conform_for_platform", "list_platforms", "probe_media", "probe_raw", "scan_folder"]);
  for (const t of tools) assert.ok(t.description && t.description.length > 40, `${t.name} needs a real description`);
});

test("check_setup finds ffmpeg", { skip }, async () => {
  const res = await client.callTool({ name: "check_setup", arguments: {} });
  assert.match(textOf(res), /Ready\./);
});

test("probe_media summarizes a file", { skip }, async () => {
  const res = await client.callTool({ name: "probe_media", arguments: { path: vertical } });
  assert.ok(!res.isError, textOf(res));
  const m = jsonOf(res);
  assert.equal(m.video[0].display_width, 1080);
  assert.equal(m.video[0].display_height, 1920);
  assert.equal(m.video[0].orientation, "vertical");
  assert.equal(m.video[0].fps_label, "30");
  assert.equal(m.audio[0].sample_rate, 48000);
  assert.equal(m.web_optimized, true);
});

test("probe_media reports a missing file as a tool error", { skip }, async () => {
  const res = await client.callTool({ name: "probe_media", arguments: { path: "/nope/missing.mp4" } });
  assert.equal(res.isError, true);
  assert.match(textOf(res), /File not found/);
});

test("check_platform_spec flags a horizontal file for Reels but passes YouTube", { skip }, async () => {
  const res = await client.callTool({ name: "check_platform_spec", arguments: { path: horizontal, platforms: ["instagram_reels", "youtube"] } });
  const data = jsonOf(res);
  const reelsAspect = data.instagram_reels.results.find((r) => r.check === "Aspect ratio");
  assert.equal(reelsAspect.status, "warn");
  const ytAspect = data.youtube.results.find((r) => r.check === "Aspect ratio");
  assert.equal(ytAspect.status, "pass");
});

test("compare_media finds the differences", { skip }, async () => {
  const res = await client.callTool({ name: "compare_media", arguments: { paths: [horizontal, vertical], only_differences: true } });
  const data = jsonOf(res);
  assert.ok(data.differences.includes("resolution"));
  assert.ok(data.differences.includes("aspect"));
});

test("scan_folder logs fixtures and writes CSV", { skip }, async () => {
  const csv = path.join(TMP, "log.csv");
  rmSync(csv, { force: true });
  const res = await client.callTool({ name: "scan_folder", arguments: { folder: TMP, extensions: ["mp4"], csv_output_path: csv } });
  assert.ok(!res.isError, textOf(res));
  assert.ok(jsonOf(res).count >= 2);
  assert.ok(existsSync(csv));
});

test("conform_for_platform dry run returns a command", { skip }, async () => {
  const res = await client.callTool({ name: "conform_for_platform", arguments: { path: horizontal, platform: "instagram_reels", fit: "blur", dry_run: true } });
  const data = jsonOf(res);
  assert.match(data.command, /filter_complex/);
  assert.deepEqual(data.target, { width: 1080, height: 1920, fps: null });
});

test("conform_for_platform encodes a Reels-ready file", { skip }, async () => {
  const out = path.join(TMP, "out_reels.mp4");
  rmSync(out, { force: true });
  const res = await client.callTool({
    name: "conform_for_platform",
    arguments: { path: horizontal, platform: "instagram_reels", fit: "crop", preset: "ultrafast", crf: 28, output_path: out },
  });
  assert.ok(!res.isError, textOf(res));
  const data = jsonOf(res);
  assert.equal(data.verdict, "pass", textOf(res));
  // refuses to overwrite without permission
  const again = await client.callTool({ name: "conform_for_platform", arguments: { path: horizontal, platform: "instagram_reels", output_path: out } });
  assert.equal(again.isError, true);
});
