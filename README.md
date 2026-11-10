# video-probe-mcp

[![CI](https://github.com/anshumanofficial2002-cpu/video-probe-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/anshumanofficial2002-cpu/video-probe-mcp/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![MCP](https://img.shields.io/badge/MCP-server-black)](https://modelcontextprotocol.io)

**Ask your AI assistant "is this ready for Reels?" and get a real answer.**

`video-probe-mcp` is a [Model Context Protocol](https://modelcontextprotocol.io) server that gives Claude (or any MCP client) eyes on your video files. It reads them with `ffprobe`, grades them against Instagram, TikTok, YouTube, X and LinkedIn upload guidelines, and can re-encode them into upload-ready files with `ffmpeg` — crop, pad, or the blurred-background vertical look.

Everything runs locally. Your footage never leaves your machine.

```
You:    Check ~/Exports/launch_v3.mov for Reels and TikTok.
Claude: ⚠️ Two problems. It's 16:9 (1920x1080) so it'll be letterboxed, and it carries
        GPS location metadata. Everything else passes. Want me to make a 9:16 version
        with a blurred background and strip the metadata?
You:    Yes.
Claude: Done → launch_v3_instagram_reels.mp4 (1080x1920, H.264, 18 MB). Re-check: ✅ PASS
```

---

## Tools

| Tool | What it does |
| --- | --- |
| `probe_media` | Spec sheet for a file: codec, resolution *as displayed* (rotation applied), orientation, aspect ratio, fps (flags variable frame rate), pixel format & bit depth, HDR type (HDR10/HLG/Dolby Vision), bitrates, audio, recording device, fast-start status, and warnings like embedded GPS. |
| `check_platform_spec` | Pass/warn/fail grading against one or more platforms, with a concrete fix for every problem. |
| `conform_for_platform` | Re-encodes to the platform's recommended export: aspect + size (crop / pad / blur), constant fps, H.264 yuv420p Rec.709, AAC 48 kHz stereo, fast start, optional metadata stripping. Re-checks the result. `dry_run` returns just the ffmpeg command. |
| `compare_media` | Side-by-side table of 2–8 files with every differing spec highlighted. Great for master vs. export or mismatched camera angles. |
| `scan_folder` | Footage log for a whole folder (optionally recursive): duration, resolution, fps, codec, HDR, audio, size per clip, totals, format breakdown, optional CSV. |
| `list_platforms` | The guidelines each check uses. |
| `probe_raw` | Full ffprobe JSON for edge cases. |
| `check_setup` | Confirms ffmpeg/ffprobe are found and shows versions. |

### Platforms

| id | Platform | Preferred aspect | Export size | Length checked |
| --- | --- | --- | --- | --- |
| `instagram_reels` | Instagram Reels | 9:16 | 1080x1920 | 3 s – 3 min |
| `instagram_feed` | Instagram feed | 4:5 (1:1, 9:16, 16:9 ok) | 1080x1350 | 3 s – 60 min |
| `tiktok` | TikTok | 9:16 | 1080x1920 | 3 s – 60 min |
| `youtube_shorts` | YouTube Shorts | 9:16 (1:1 ok) | 1080x1920 | up to 3 min |
| `youtube` | YouTube long-form | 16:9 | 1920x1080 | up to 12 h |
| `x` | X (Twitter) | 16:9 (1:1, 9:16, 4:5 ok) | 1920x1080 | up to 2:20 |
| `linkedin` | LinkedIn | 1:1 (16:9, 9:16, 4:5 ok) | 1080x1080 | 3 s – 15 min |

> These are practical guidelines, last reviewed November 2026. Platforms change limits often and roll them out per account and region, so length and size limits are reported as **warnings**, not failures. Override any field per call with `custom_spec`, e.g. `{ "max_duration_seconds": 900 }`.

### What gets checked

Container · video codec · pixel format / bit depth · HDR vs SDR · aspect ratio · resolution · frame rate (and VFR) · duration · file size · bitrate (too low = blocky after re-encode) · audio codec / sample rate / channels · fast start (moov atom position) · GPS location metadata.

---

## Requirements

- **Node.js 20+**
- **ffmpeg and ffprobe**
  - macOS: `brew install ffmpeg`
  - Ubuntu/Debian: `sudo apt install ffmpeg`
  - Windows: `winget install ffmpeg`

The server looks for the binaries in `FFMPEG_PATH` / `FFPROBE_PATH`, then your `PATH`, then common install folders (`/opt/homebrew/bin`, `/usr/local/bin`, …). That last step matters: Claude Desktop on macOS launches servers with a minimal `PATH` that often misses Homebrew.

## Install

No npm publish needed — it runs straight from GitHub with `npx`.

### Claude Desktop

Open **Settings → Developer → Edit Config** and add:

```json
{
  "mcpServers": {
    "video-probe": {
      "command": "npx",
      "args": ["-y", "github:anshumanofficial2002-cpu/video-probe-mcp"]
    }
  }
}
```

Restart Claude Desktop.

### Claude Code

```sh
claude mcp add video-probe -- npx -y github:anshumanofficial2002-cpu/video-probe-mcp
```

### Cursor / Windsurf / VS Code / other MCP clients

Use the same command in your client's MCP config:

```json
{
  "video-probe": {
    "command": "npx",
    "args": ["-y", "github:anshumanofficial2002-cpu/video-probe-mcp"]
  }
}
```

### From source

```sh
git clone https://github.com/anshumanofficial2002-cpu/video-probe-mcp.git
cd video-probe-mcp
npm install
npm run build
# then point your client at: node /absolute/path/to/video-probe-mcp/dist/index.js
```

If ffmpeg lives somewhere unusual, add it to the config:

```json
"env": { "FFMPEG_PATH": "/path/to/ffmpeg", "FFPROBE_PATH": "/path/to/ffprobe" }
```

---

## Example prompts

- "What are the specs of `~/Desktop/A001_C003.mov`?"
- "Is `final.mp4` ready for Instagram Reels, TikTok and YouTube Shorts?"
- "Make a 9:16 version of `podcast_clip.mp4` for TikTok with blurred bars, keep the speaker on the left third."
- "Compare `master.mov` and `export.mp4` — did anything change besides the codec?"
- "Log every clip on `/Volumes/CARD_01` recursively and save the log as CSV on my Desktop."
- "Strip location metadata from `vlog.mp4` before I post it." *(uses `conform_for_platform` with `strip_metadata`)*
- "Just give me the ffmpeg command to make this LinkedIn-ready, don't run it."

---

## Tool reference

### `probe_media`

| Param | Type | Default | Notes |
| --- | --- | --- | --- |
| `path` | string | — | Local file. `~` is expanded. |
| `include_location` | boolean | `false` | Include raw GPS coordinates. Otherwise the result only says whether location exists. |

### `check_platform_spec`

| Param | Type | Default | Notes |
| --- | --- | --- | --- |
| `path` | string | — | |
| `platforms` | string[] | `["instagram_reels"]` | Any of the ids above. |
| `custom_spec` | object | — | Partial override: `aspect`, `resolution`, `min_duration_seconds`, `max_duration_seconds`, `max_file_size_bytes`, `fps_range`. |

### `conform_for_platform`

| Param | Type | Default | Notes |
| --- | --- | --- | --- |
| `path` | string | — | Source file. |
| `platform` | string | — | Target platform id. |
| `output_path` | string | `<name>_<platform>.mp4` next to source | Never overwritten unless `overwrite: true`. |
| `fit` | `crop` \| `pad` \| `blur` | `crop` | How to handle a different aspect ratio. |
| `crop_anchor` | 0–1 | `0.5` | For `crop`: 0 = keep left/top, 1 = right/bottom. |
| `pad_color` | string | `black` | For `pad`: ffmpeg color name or `0xRRGGBB`. |
| `crf` | 0–51 | `18` | Lower = better quality, bigger file. |
| `preset` | x264 preset | `medium` | `veryfast` for speed, `slow` for size. |
| `fps` | number | source | Forced rate. By default only VFR or over-limit sources are changed. |
| `width` / `height` | int | platform size | Override output size. |
| `start` / `duration` | time / seconds | — | Trim. `start` accepts `12.5` or `00:00:12.5`. |
| `audio_bitrate_kbps` | int | `192` | |
| `strip_metadata` | boolean | `true` | Removes GPS, device info, chapters. |
| `dry_run` | boolean | `false` | Return the command without encoding. |
| `overwrite` | boolean | `false` | |

HDR sources are converted to 8-bit yuv420p but **not tone-mapped**; the tool warns you. For accurate SDR color, tone-map in your editor first.

### `compare_media`

`paths` (2–8 files), `only_differences` (default `false`).

### `scan_folder`

| Param | Type | Default |
| --- | --- | --- |
| `folder` | string | — |
| `recursive` | boolean | `false` |
| `extensions` | string[] | common video + audio types |
| `max_files` | int | `300` (max 2000) |
| `csv_output_path` | string | — |
| `overwrite` | boolean | `false` |

### `probe_raw`

`path`, `stream` (`all` \| `video` \| `audio` \| `subtitle`).

---

## Safety

- **No shell.** ffmpeg/ffprobe run via `spawn` with argument arrays, so odd file names can't inject commands.
- **No surprise overwrites.** Output files are refused if they exist unless you pass `overwrite: true`, and output can never equal input.
- **Local only.** No network calls, no telemetry.
- **Privacy aware.** GPS metadata is flagged, hidden by default, and stripped by `conform_for_platform` unless you opt out.

## Troubleshooting

**"ffmpeg/ffprobe were not found"** — install ffmpeg, or set `FFMPEG_PATH` and `FFPROBE_PATH` in your client config. Run the `check_setup` tool to see what the server found.

**Encodes are slow** — use `preset: "veryfast"`. CRF 18 at `medium` is the quality-first default.

**Colors look flat after conforming** — your source is HDR (iPhone footage often is). Export SDR from your editor, then conform.

## Development

```sh
npm install
npm run build     # compile TypeScript to dist/
npm test          # unit tests + end-to-end tests over stdio (needs ffmpeg)
npm run inspect   # open the MCP Inspector against the local build
```

`dist/` is committed so `npx github:…` works without a build step; CI checks it stays in sync with `src/`.

## Related servers

Part of a small set of creator-focused MCP servers:

- [video-probe-mcp](https://github.com/anshumanofficial2002-cpu/video-probe-mcp) — inspect and conform video for each platform
- [caption-forge-mcp](https://github.com/anshumanofficial2002-cpu/caption-forge-mcp) — SRT/VTT/ASS conversion, timing, linting and reel-style captions
- [loudness-check-mcp](https://github.com/anshumanofficial2002-cpu/loudness-check-mcp) — LUFS, true peak, normalization, silence and clipping
- [frame-grab-mcp](https://github.com/anshumanofficial2002-cpu/frame-grab-mcp) — frames, contact sheets, scene cuts and thumbnails your AI can see
- [script-timer-mcp](https://github.com/anshumanofficial2002-cpu/script-timer-mcp) — time, trim and format scripts for short-form video

## License

[MIT](LICENSE) © 2026 Anshuman
