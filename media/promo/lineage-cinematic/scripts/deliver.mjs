import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";

const input = "renders/lineage-cinematic.mp4";
const output = "../lineage-cinematic.mp4";
const { version } = JSON.parse(readFileSync("node_modules/hyperframes/package.json", "utf8"));
assert.equal(version, "0.8.10", "Re-check the rendering contract before changing HyperFrames");
execFileSync("ffmpeg", [
  "-v", "error", "-y", "-i", input, "-map", "0", "-c", "copy",
  "-metadata", "hyperframes_renderer=hyperframes",
  "-metadata", `hyperframes_version=${version}`,
  "-metadata", "comment=Original frames rendered by HyperFrames 0.8.10; stream-copy fast-start remux.",
  "-movflags", "+faststart+use_metadata_tags", output,
]);
const probe = JSON.parse(execFileSync("ffprobe", [
  "-v", "error", "-show_streams", "-show_format", "-of", "json", output,
], { encoding: "utf8" }));
assert.equal(probe.streams.length, 1, "The film is intentionally silent");
const video = probe.streams[0];
assert.equal(video.codec_name, "h264");
assert.equal(video.width, 1920);
assert.equal(video.height, 1080);
assert.equal(video.pix_fmt, "yuv420p");
assert.equal(video.r_frame_rate, "60/1");
assert.equal(Number(video.nb_frames), 1380);
assert.equal(Number(video.duration), 23);
assert.ok(statSync(output).size < 15_000_000, "Delivery exceeds the 15 MB target");
execFileSync("ffmpeg", ["-v", "error", "-xerror", "-i", output, "-f", "null", "-"]);
const bytes = readFileSync(output);
let cursor = 0;
const atoms = [];
while (cursor + 8 <= bytes.length) {
  const size = bytes.readUInt32BE(cursor);
  const type = bytes.toString("ascii", cursor + 4, cursor + 8);
  atoms.push(type);
  const length = size === 1 ? Number(bytes.readBigUInt64BE(cursor + 8)) : size || bytes.length - cursor;
  assert.ok(length >= 8 && cursor + length <= bytes.length, `Invalid MP4 ${type} atom`);
  cursor += length;
}
assert.ok(atoms.indexOf("moov") >= 0 && atoms.indexOf("moov") < atoms.indexOf("mdat"), "MP4 is not fast-start");
console.log(`${output}: H.264, 1920x1080, 60 fps, 23 seconds, 1380 frames, yuv420p, silent, fast-start.`);
console.log(`${(bytes.length / 1_000_000).toFixed(2)} MB; complete decode succeeded.`);
