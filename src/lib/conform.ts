/** Build an ffmpeg command that conforms a file to a platform's recommended export. */
import type { MediaSummary } from "./probe.js";
import { aspectMatches, type PlatformSpec } from "./specs.js";

export type Fit = "crop" | "pad" | "blur";

export interface ConformOptions {
  fit: Fit;
  crf: number;
  preset: string;
  fps?: number;
  width?: number;
  height?: number;
  audioBitrateKbps: number;
  stripMetadata: boolean;
  padColor: string;
  /** Crop anchor when fit = crop: 0 = left/top, 0.5 = center, 1 = right/bottom. */
  cropAnchor: number;
  start?: number;
  duration?: number;
}

export interface ConformPlan {
  args: string[];
  target: { width: number; height: number; fps: number | null };
  steps: string[];
  warnings: string[];
}

const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);

export function buildConformArgs(input: string, output: string, m: MediaSummary, spec: PlatformSpec, o: ConformOptions): ConformPlan {
  const v = m.video[0];
  if (!v) throw new Error("This file has no video stream to conform.");
  const steps: string[] = [];
  const warnings: string[] = [];

  const W = even(o.width ?? spec.resolution.width);
  const H = even(o.height ?? spec.resolution.height);
  const sameAspect = aspectMatches(v.display_width, v.display_height, { w: W, h: H }, 0.01);

  let filter: string;
  let complex = false;
  if (sameAspect) {
    filter = `scale=${W}:${H}:flags=lanczos,setsar=1`;
    steps.push(`Scale ${v.display_width}x${v.display_height} → ${W}x${H} (aspect already matches).`);
  } else if (o.fit === "crop") {
    const ax = Math.min(1, Math.max(0, o.cropAnchor));
    filter = `scale=${W}:${H}:force_original_aspect_ratio=increase:flags=lanczos,crop=${W}:${H}:(iw-${W})*${ax}:(ih-${H})*${ax},setsar=1`;
    steps.push(`Fill ${W}x${H} by scaling up and cropping the overflow (anchor ${ax}).`);
    warnings.push("Cropping removes part of the frame — check that faces and on-screen text survive.");
  } else if (o.fit === "pad") {
    filter = `scale=${W}:${H}:force_original_aspect_ratio=decrease:flags=lanczos,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=${o.padColor},setsar=1`;
    steps.push(`Fit inside ${W}x${H} and pad with ${o.padColor} bars.`);
  } else {
    complex = true;
    filter =
      `[0:v]split=2[bgsrc][fgsrc];` +
      `[bgsrc]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},boxblur=luma_radius=40:luma_power=2,eq=brightness=-0.06[bg];` +
      `[fgsrc]scale=${W}:${H}:force_original_aspect_ratio=decrease:flags=lanczos[fg];` +
      `[bg][fg]overlay=(W-w)/2:(H-h)/2,setsar=1`;
    steps.push(`Fit inside ${W}x${H} over a blurred, darkened copy of the same shot (the "blur bars" look).`);
  }

  let fps: number | null = null;
  if (o.fps) fps = o.fps;
  else if (v.fps && v.fps > spec.fps_range[1] + 0.1) fps = spec.fps_range[1];
  else if (v.variable_frame_rate && v.fps) fps = Math.round(v.fps) === 30 ? 30 : Math.round(v.fps);
  if (fps) {
    filter += `,fps=${fps}`;
    steps.push(`Constant ${fps} fps.`);
  }

  if (v.hdr !== "SDR") {
    warnings.push(`Source is ${v.hdr}. This command converts to 8-bit yuv420p but does not tone-map, so colors may look flat. For a proper SDR version, tone-map in your editor first.`);
  }

  const args: string[] = ["-hide_banner", "-y"];
  if (o.start !== undefined) args.push("-ss", String(o.start));
  args.push("-i", input);
  if (o.duration !== undefined) args.push("-t", String(o.duration));

  if (complex) {
    args.push("-filter_complex", filter + "[vout]", "-map", "[vout]");
  } else {
    args.push("-map", "0:v:0", "-vf", filter);
  }
  args.push("-map", "0:a:0?");

  args.push(
    "-c:v", "libx264",
    "-preset", o.preset,
    "-crf", String(o.crf),
    "-profile:v", "high",
    "-pix_fmt", "yuv420p",
    "-color_primaries", "bt709", "-color_trc", "bt709", "-colorspace", "bt709",
    "-c:a", "aac",
    "-b:a", `${o.audioBitrateKbps}k`,
    "-ar", "48000",
    "-ac", "2",
    "-movflags", "+faststart",
  );
  steps.push(`H.264 High, CRF ${o.crf}, preset ${o.preset}, yuv420p, Rec.709 tags; AAC ${o.audioBitrateKbps} kbps 48 kHz stereo; fast start.`);

  if (o.stripMetadata) {
    args.push("-map_metadata", "-1", "-map_chapters", "-1");
    steps.push("Strip metadata (GPS location, device info, chapters).");
  }
  args.push(output);

  return { args, target: { width: W, height: H, fps }, steps, warnings };
}
