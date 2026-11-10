#!/usr/bin/env node
/**
 * video-probe-mcp — inspect, check and conform video files for social platforms.
 */
import { readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { buildConformArgs } from "./lib/conform.js";
import { expandPath, installHelp, parseTimestamp, prepareOutput, requireDir, requireFile, resolveBinary, runOrThrow, SetupError, toCommand, versionOf, } from "./lib/ffmpeg.js";
import { describe, ffprobeJson, summarize } from "./lib/probe.js";
import { checkAgainst, mergeSpec, PLATFORMS, SPECS_REVIEWED } from "./lib/specs.js";
import { formatBytes, formatDuration, guard, markdownTable, ok } from "./lib/tool.js";
const VERSION = "1.0.0";
const MEDIA_EXTS = [".mp4", ".mov", ".m4v", ".mkv", ".webm", ".avi", ".mxf", ".mts", ".m2ts", ".3gp", ".wav", ".mp3", ".m4a", ".aac", ".flac"];
const platformIds = Object.keys(PLATFORMS);
const server = new McpServer({ name: "video-probe-mcp", version: VERSION }, {
    instructions: "Tools for inspecting video files on the user's machine. Use probe_media for a quick human-readable spec sheet, " +
        "check_platform_spec before uploading to Instagram/TikTok/YouTube/X/LinkedIn, compare_media to spot differences between exports, " +
        "scan_folder to log a whole card of footage, and conform_for_platform to produce an upload-ready file. All paths are local file paths.",
});
const pathArg = z.string().describe("Absolute path to a local media file. ~ is expanded.");
server.registerTool("check_setup", {
    title: "Check ffmpeg setup",
    description: "Confirm ffmpeg and ffprobe are installed and report their versions and paths. Run this first if other tools fail.",
    inputSchema: {},
    annotations: { readOnlyHint: true },
}, async () => guard(async () => {
    try {
        const [ffprobe, ffmpeg] = await Promise.all([resolveBinary("ffprobe"), resolveBinary("ffmpeg")]);
        const [pv, fv] = await Promise.all([versionOf("ffprobe"), versionOf("ffmpeg")]);
        return ok(`ffprobe: ${ffprobe}\n  ${pv}\nffmpeg: ${ffmpeg}\n  ${fv}\nReady.`, { ffprobe, ffmpeg, ffprobe_version: pv, ffmpeg_version: fv, server_version: VERSION });
    }
    catch (e) {
        if (e instanceof SetupError)
            return ok(e.message, { ready: false });
        throw e;
    }
}));
server.registerTool("probe_media", {
    title: "Inspect a media file",
    description: "Spec sheet for one video or audio file: container, duration, size, codec, resolution as displayed (rotation applied), orientation, aspect ratio, " +
        "frame rate (flags variable frame rate), pixel format and bit depth, HDR type, bitrates, audio format, recording device, " +
        "whether it is web-optimized (fast start), and warnings such as embedded GPS location.",
    inputSchema: {
        path: pathArg,
        include_location: z.boolean().default(false).describe("Include the raw GPS coordinates if present. Off by default; the summary only says whether location exists."),
    },
    annotations: { readOnlyHint: true },
}, async ({ path: p, include_location }) => guard(async () => {
    const file = await requireFile(p);
    const m = await summarize(file, { includeLocation: include_location });
    return ok(describe(m), m);
}));
server.registerTool("probe_raw", {
    title: "Raw ffprobe output",
    description: "Full ffprobe JSON (format, streams, chapters) for debugging edge cases the summary does not cover. Can be long.",
    inputSchema: {
        path: pathArg,
        stream: z.enum(["all", "video", "audio", "subtitle"]).default("all").describe("Limit to one stream type."),
    },
    annotations: { readOnlyHint: true },
}, async ({ path: p, stream }) => guard(async () => {
    const file = await requireFile(p);
    const extra = stream === "all" ? [] : ["-select_streams", stream[0]];
    const raw = await ffprobeJson(file, extra);
    return ok(`ffprobe output for ${path.basename(file)}`, raw);
}));
server.registerTool("list_platforms", {
    title: "List platform specs",
    description: "Show the upload guidelines this server checks against for each platform (aspect, resolution, duration, size, frame rate, codecs, notes).",
    inputSchema: {},
    annotations: { readOnlyHint: true },
}, async () => guard(async () => {
    const rows = Object.values(PLATFORMS).map((s) => [
        s.id,
        s.name,
        `${s.aspect.w}:${s.aspect.h}`,
        `${s.resolution.width}x${s.resolution.height}`,
        `${s.min_duration_seconds}–${s.max_duration_seconds}s`,
        formatBytes(s.max_file_size_bytes),
        `${s.fps_range[0]}–${s.fps_range[1]}`,
    ]);
    const table = markdownTable(["id", "platform", "aspect", "export size", "duration", "max size", "fps"], rows);
    return ok(`${table}\n\nGuidelines last reviewed ${SPECS_REVIEWED}. Limits vary by account and region; override any field with custom_spec.`, PLATFORMS);
}));
const customSpecSchema = z
    .object({
    aspect: z.object({ w: z.number().positive(), h: z.number().positive() }).optional(),
    resolution: z.object({ width: z.number().int().positive(), height: z.number().int().positive() }).optional(),
    min_duration_seconds: z.number().nonnegative().optional(),
    max_duration_seconds: z.number().positive().optional(),
    max_file_size_bytes: z.number().positive().optional(),
    fps_range: z.tuple([z.number(), z.number()]).optional(),
})
    .optional()
    .describe("Override parts of the platform spec, e.g. { max_duration_seconds: 900 } if your account allows longer uploads.");
const ICON = { pass: "✅", warn: "⚠️", fail: "❌", info: "ℹ️" };
server.registerTool("check_platform_spec", {
    title: "Check a file against platform specs",
    description: "Grade a video against one or more platforms' upload guidelines (Instagram Reels/feed, TikTok, YouTube Shorts/long-form, X, LinkedIn). " +
        "Checks container, codec, pixel format, HDR, aspect ratio, resolution, frame rate, duration, size, bitrate, audio, fast start and GPS metadata, " +
        "and gives a fix for anything that fails.",
    inputSchema: {
        path: pathArg,
        platforms: z.array(z.enum(platformIds)).min(1).default(["instagram_reels"]).describe(`Platforms to check: ${platformIds.join(", ")}`),
        custom_spec: customSpecSchema,
    },
    annotations: { readOnlyHint: true },
}, async ({ path: p, platforms, custom_spec }) => guard(async () => {
    const file = await requireFile(p);
    const m = await summarize(file);
    const out = [describe(m), ""];
    const data = {};
    for (const id of platforms) {
        const spec = mergeSpec(PLATFORMS[id], custom_spec);
        const { results, verdict } = checkAgainst(m, spec);
        data[id] = { verdict, results, notes: spec.notes };
        out.push(`### ${spec.name}: ${ICON[verdict]} ${verdict.toUpperCase()}`);
        out.push(markdownTable(["", "check", "actual", "expected", "fix"], results.map((r) => [ICON[r.status], r.check, r.actual, r.expected, r.fix ?? ""])));
        if (spec.notes.length)
            out.push(...spec.notes.map((n) => `> ${n}`));
        out.push("");
    }
    out.push(`_Guidelines reviewed ${SPECS_REVIEWED}; platforms change limits per account and region._`);
    return ok(out.join("\n"), data);
}));
function flatten(m) {
    const v = m.video[0];
    const a = m.audio[0];
    return {
        container: m.container,
        duration: m.duration_seconds?.toFixed(3) ?? "—",
        size: formatBytes(m.size_bytes),
        "overall bitrate": m.overall_bitrate_bps ? `${(m.overall_bitrate_bps / 1e6).toFixed(2)} Mbps` : "—",
        "video codec": v ? `${v.codec}${v.profile ? ` ${v.profile}` : ""}` : "—",
        resolution: v ? `${v.display_width}x${v.display_height}` : "—",
        aspect: v?.aspect_label ?? "—",
        fps: v ? `${v.fps_label}${v.variable_frame_rate ? " VFR" : ""}` : "—",
        "pixel format": v?.pixel_format ?? "—",
        "bit depth": v?.bit_depth ? String(v.bit_depth) : "—",
        "color (prim/trc/space)": v ? `${v.color_primaries ?? "?"}/${v.color_transfer ?? "?"}/${v.color_space ?? "?"}` : "—",
        "dynamic range": v?.hdr ?? "—",
        "video bitrate": v?.bitrate_bps ? `${(v.bitrate_bps / 1e6).toFixed(2)} Mbps` : "—",
        "audio codec": a?.codec ?? "none",
        "audio rate": a?.sample_rate ? `${a.sample_rate} Hz` : "—",
        "audio channels": a ? (a.channel_layout ?? String(a.channels)) : "—",
        "audio bitrate": a?.bitrate_bps ? `${Math.round(a.bitrate_bps / 1000)} kbps` : "—",
        "fast start": m.web_optimized === null ? "n/a" : m.web_optimized ? "yes" : "no",
        "GPS metadata": m.has_gps_location ? "yes" : "no",
    };
}
server.registerTool("compare_media", {
    title: "Compare media files",
    description: "Compare two or more files side by side (e.g. master vs. export, or two camera angles) and highlight every spec that differs.",
    inputSchema: {
        paths: z.array(z.string()).min(2).max(8).describe("2–8 absolute file paths."),
        only_differences: z.boolean().default(false).describe("Show only rows that differ."),
    },
    annotations: { readOnlyHint: true },
}, async ({ paths, only_differences }) => guard(async () => {
    const files = await Promise.all(paths.map(requireFile));
    const sums = await Promise.all(files.map((f) => summarize(f)));
    const flats = sums.map(flatten);
    const keys = Object.keys(flats[0]);
    const diffs = [];
    const rows = [];
    for (const k of keys) {
        const vals = flats.map((f) => f[k]);
        const differs = new Set(vals).size > 1;
        if (differs)
            diffs.push(k);
        if (!only_differences || differs)
            rows.push([differs ? `**${k}**` : k, ...vals]);
    }
    const table = markdownTable(["spec", ...sums.map((s) => s.file_name)], rows);
    const head = diffs.length ? `${diffs.length} spec(s) differ: ${diffs.join(", ")}.` : "All compared specs match.";
    return ok(`${head}\n\n${table}`, { differences: diffs, files: flats.map((f, i) => ({ file: files[i], ...f })) });
}));
async function listMedia(dir, recursive, exts) {
    const entries = await readdir(dir, { recursive, withFileTypes: true });
    const out = [];
    for (const e of entries) {
        if (!e.isFile() || e.name.startsWith("._"))
            continue;
        if (exts.includes(path.extname(e.name).toLowerCase())) {
            const parent = e.parentPath ?? e.path ?? dir;
            out.push(path.join(parent, e.name));
        }
    }
    return out.sort();
}
async function mapLimit(items, limit, fn) {
    const results = new Array(items.length);
    let i = 0;
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
        while (i < items.length) {
            const idx = i++;
            results[idx] = await fn(items[idx]);
        }
    }));
    return results;
}
function csvCell(v) {
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
server.registerTool("scan_folder", {
    title: "Scan a folder of footage",
    description: "Probe every media file in a folder (optionally recursive) and return a footage log: duration, resolution, fps, codec, HDR, audio and size per clip, " +
        "plus totals and a breakdown by format. Optionally writes the log as CSV. Good for logging a camera card or a client's dump of clips.",
    inputSchema: {
        folder: z.string().describe("Absolute folder path."),
        recursive: z.boolean().default(false),
        extensions: z.array(z.string()).optional().describe(`File extensions to include (default: ${MEDIA_EXTS.join(" ")}).`),
        max_files: z.number().int().min(1).max(2000).default(300),
        csv_output_path: z.string().optional().describe("If set, also write the log to this CSV file."),
        overwrite: z.boolean().default(false),
    },
    annotations: { readOnlyHint: false },
}, async ({ folder, recursive, extensions, max_files, csv_output_path, overwrite }) => guard(async () => {
    const dir = await requireDir(folder);
    const exts = (extensions ?? MEDIA_EXTS).map((e) => (e.startsWith(".") ? e : `.${e}`).toLowerCase());
    const all = await listMedia(dir, recursive, exts);
    const files = all.slice(0, max_files);
    const results = await mapLimit(files, 4, async (f) => {
        try {
            return { file: f, summary: await summarize(f) };
        }
        catch (e) {
            return { file: f, error: e instanceof Error ? e.message.split("\n")[0] : String(e) };
        }
    });
    const header = ["file", "duration_s", "resolution", "fps", "codec", "dynamic_range", "audio", "size"];
    const rows = [];
    let totalDur = 0;
    let totalSize = 0;
    const byFormat = new Map();
    for (const r of results) {
        const rel = path.relative(dir, r.file);
        if ("error" in r) {
            rows.push([rel, "—", "—", "—", "—", "—", "—", `error: ${r.error}`]);
            continue;
        }
        const m = r.summary;
        const v = m.video[0];
        const a = m.audio[0];
        totalDur += m.duration_seconds ?? 0;
        totalSize += m.size_bytes;
        const fmt = v ? `${v.display_width}x${v.display_height} ${v.fps_label}fps ${v.codec}${v.hdr !== "SDR" ? " HDR" : ""}` : `audio ${a?.codec ?? "?"}`;
        byFormat.set(fmt, (byFormat.get(fmt) ?? 0) + 1);
        rows.push([
            rel,
            m.duration_seconds?.toFixed(2) ?? "—",
            v ? `${v.display_width}x${v.display_height}` : "—",
            v ? `${v.fps_label}${v.variable_frame_rate ? " VFR" : ""}` : "—",
            v?.codec ?? a?.codec ?? "—",
            v?.hdr ?? "—",
            a ? `${a.codec} ${a.channels}ch ${a.sample_rate ? a.sample_rate / 1000 + "k" : ""}` : "none",
            formatBytes(m.size_bytes),
        ]);
    }
    let csvNote = "";
    if (csv_output_path) {
        const out = await prepareOutput(csv_output_path, overwrite);
        await writeFile(out, [header, ...rows].map((r) => r.map(csvCell).join(",")).join("\n") + "\n", "utf8");
        csvNote = `\nCSV written to ${out}`;
    }
    const formats = [...byFormat.entries()].sort((a, b) => b[1] - a[1]).map(([f, n]) => `- ${n} × ${f}`).join("\n");
    const truncated = all.length > files.length ? `\n(Showing ${files.length} of ${all.length} files; raise max_files to include more.)` : "";
    const summaryText = `${files.length} media file(s) in ${dir}${recursive ? " (recursive)" : ""} — total ${formatDuration(totalDur)}, ${formatBytes(totalSize)}.${truncated}\n\n` +
        `Formats:\n${formats || "- none"}\n\n${markdownTable(header, rows)}${csvNote}`;
    return ok(summaryText, { folder: dir, count: files.length, total_files_found: all.length, total_duration_seconds: totalDur, total_size_bytes: totalSize });
}));
server.registerTool("conform_for_platform", {
    title: "Conform a video for a platform",
    description: "Re-encode a video into an upload-ready file for a platform: correct aspect ratio and size (crop to fill, pad with bars, or the blurred-background look), " +
        "constant frame rate, H.264 yuv420p with Rec.709 tags, AAC 48 kHz stereo, fast start, and optional metadata stripping (removes GPS). " +
        "Set dry_run to only get the ffmpeg command. Never overwrites an existing file unless overwrite is true.",
    inputSchema: {
        path: pathArg,
        platform: z.enum(platformIds).describe(`Target platform: ${platformIds.join(", ")}`),
        output_path: z.string().optional().describe("Where to write the result. Defaults to <name>_<platform>.mp4 next to the source."),
        fit: z.enum(["crop", "pad", "blur"]).default("crop").describe("How to handle a different aspect ratio: crop to fill, pad with solid bars, or blur = blurred copy of the shot behind it."),
        crop_anchor: z.number().min(0).max(1).default(0.5).describe("For fit=crop: 0 keeps the left/top, 0.5 the center, 1 the right/bottom."),
        pad_color: z.string().default("black").describe("For fit=pad: an ffmpeg color name or hex like 0x111111."),
        crf: z.number().int().min(0).max(51).default(18).describe("Quality: lower is better and larger. 18 is visually lossless for most footage."),
        preset: z.enum(["ultrafast", "veryfast", "faster", "fast", "medium", "slow", "slower"]).default("medium"),
        fps: z.number().positive().max(120).optional().describe("Force a frame rate. By default the source rate is kept unless it is variable or above the platform max."),
        width: z.number().int().positive().optional().describe("Override the output width."),
        height: z.number().int().positive().optional().describe("Override the output height."),
        start: z.union([z.number(), z.string()]).optional().describe("Trim start: seconds or HH:MM:SS.mmm."),
        duration: z.number().positive().optional().describe("Trim length in seconds."),
        audio_bitrate_kbps: z.number().int().min(64).max(512).default(192),
        strip_metadata: z.boolean().default(true).describe("Remove metadata such as GPS location and device info."),
        dry_run: z.boolean().default(false).describe("Only return the ffmpeg command; do not encode."),
        overwrite: z.boolean().default(false),
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
}, async (a) => guard(async () => {
    const file = await requireFile(a.path);
    const m = await summarize(file);
    const spec = PLATFORMS[a.platform];
    const defaultOut = path.join(path.dirname(file), `${path.parse(file).name}_${a.platform}.mp4`);
    const outPath = expandPath(a.output_path ?? defaultOut);
    const plan = buildConformArgs(file, outPath, m, spec, {
        fit: a.fit,
        crf: a.crf,
        preset: a.preset,
        fps: a.fps,
        width: a.width,
        height: a.height,
        audioBitrateKbps: a.audio_bitrate_kbps,
        stripMetadata: a.strip_metadata,
        padColor: a.pad_color,
        cropAnchor: a.crop_anchor,
        start: a.start === undefined ? undefined : parseTimestamp(a.start),
        duration: a.duration,
    });
    const cmd = toCommand("ffmpeg", plan.args);
    const planText = `Plan for ${spec.name}:\n${plan.steps.map((s) => `- ${s}`).join("\n")}${plan.warnings.length ? `\n\nWarnings:\n${plan.warnings.map((w) => `- ${w}`).join("\n")}` : ""}\n\nCommand:\n\`\`\`sh\n${cmd}\n\`\`\``;
    if (a.dry_run)
        return ok(planText, { command: cmd, args: plan.args, target: plan.target });
    await prepareOutput(outPath, a.overwrite, file);
    const started = Date.now();
    const timeout = Math.max(10 * 60 * 1000, (m.duration_seconds ?? 60) * 20 * 1000);
    await runOrThrow("ffmpeg", plan.args, { timeoutMs: timeout });
    const after = await summarize(outPath);
    const { results, verdict } = checkAgainst(after, spec);
    const secs = ((Date.now() - started) / 1000).toFixed(1);
    return ok(`${planText}\n\nDone in ${secs}s → ${outPath}\n${describe(after)}\n\nRe-check for ${spec.name}: ${ICON[verdict]} ${verdict.toUpperCase()}` +
        (verdict !== "pass" ? `\n${results.filter((r) => r.status === "warn" || r.status === "fail").map((r) => `- ${r.check}: ${r.actual} (${r.fix ?? r.expected})`).join("\n")}` : ""), { output: outPath, seconds: Number(secs), verdict, size_bytes: (await stat(outPath)).size });
}));
async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    // Log to stderr only — stdout is the MCP channel.
    resolveBinary("ffprobe").catch(() => console.error(`[video-probe-mcp] ${installHelp()}`));
    console.error(`[video-probe-mcp] v${VERSION} ready on stdio`);
}
main().catch((e) => {
    console.error("[video-probe-mcp] fatal:", e);
    process.exit(1);
});
