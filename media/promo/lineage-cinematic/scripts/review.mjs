import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";

const input = process.argv[2] || "renders/first-cut.mp4";
const output = process.argv[3] || "review/first";
const times = [0, 1.3, 2.7, 3.6, 4.2, 4.9, 5.7, 7.2, 8.4, 9.4, 10.7, 12, 13.4, 14.3, 15.4, 17, 18.8, 19.3, 20, 22.9];
mkdirSync(output, { recursive: true });
const composites = [];
for (const [index, time] of times.entries()) {
  const frame = path.join(output, `${time.toFixed(2)}.png`);
  execFileSync("ffmpeg", ["-v", "error", "-y", "-ss", String(time), "-i", input, "-frames:v", "1", "-update", "1", frame]);
  const label = Buffer.from(`<svg width="480" height="34"><rect width="480" height="34" fill="#121114"/><text x="16" y="23" font-family="Arial,sans-serif" font-size="17" fill="#ffffff">${time.toFixed(2)}s</text></svg>`);
  const thumbnail = await sharp(frame).resize(480, 270).extend({ top: 34, bottom: 0, left: 0, right: 0, background: "#121114" }).composite([{ input: label, top: 0, left: 0 }]).png().toBuffer();
  composites.push({ input: thumbnail, left: (index % 4) * 480, top: Math.floor(index / 4) * 304 });
}
await sharp({ create: { width: 1920, height: 1520, channels: 3, background: "#121114" } })
  .composite(composites).jpeg({ quality: 90 }).toFile(path.join(output, "contact-sheet.jpg"));
console.log(path.resolve(output, "contact-sheet.jpg"));
