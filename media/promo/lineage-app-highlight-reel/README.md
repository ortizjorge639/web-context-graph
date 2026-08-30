# Lineage App highlight reel

Editable HyperFrames source for the silent Lineage App promotional reel at
[`../lineage-app-highlight-reel.mp4`](../lineage-app-highlight-reel.mp4).
HyperFrames `0.8.10` and GSAP `3.14.2` are pinned in `package-lock.json`; all
product captures and runtime assets are local so frame rendering does not
depend on the network.

## Storyboard

| Time | Beat | Visual and motion |
| --- | --- | --- |
| 0.0-2.7s | Hook | The product mark draws from one node into multiple directions as thread cards assemble around `One answer. More than one direction.` |
| 2.3-5.8s | Addressable blocks | The real branch composer capture arrives as its selected response block emits a coral path and a child card. `Branch from the block that matters.` |
| 5.2-8.5s | Isolated lineage | The camera traverses into the real child-thread capture. A single root-to-current path stays lit while sibling labels remain separate. `Carry the path. Leave siblings out.` |
| 7.9-11.3s | Knowledge Tree | The real tree view fills the frame; outward paths draw across its strict single-parent topology. `See every branch.` |
| 10.7-13.9s | Ownership | Motion relaxes over the real Files view while `thread.md`, `meta.yaml`, `index.md`, `AGENTS.md`, and local Git settle into a durable file rail. `Keep the trail in files you own.` |
| 13.2-17.4s | End card | The mark resolves into the Lineage App lockup, exact tagline, boundary label, and landing URL with a long readable dwell. |

The overlapping scene windows preserve continuity: a path becomes a camera
move, the camera move becomes the next path, and the ownership beat deliberately
slows before the close. Every branch only moves outward; no visual suggests
convergence, span-level branching, hosted sync, arbitrary providers, or
multi-user collaboration.

## Assets

The four WebP captures in `assets/` are byte-for-byte copies of the matching
desktop captures in `site/assets/`. Keeping the composition self-contained lets
the HyperFrames project server resolve them reliably.

## Reproduce

Requires Node.js 22+ and FFmpeg.

```bash
cd media/promo/lineage-app-highlight-reel
npm ci
npm run lint
npm run check
npm run snapshot
npm run render
npm run tag
```

The snapshot command writes review-only PNGs under ignored `snapshots/`. The
render command writes the delivery MP4 to `media/promo/lineage-app-highlight-reel.mp4`.
HyperFrames 0.8.10 currently writes its package version tag as `0.0.0-dev`;
`npm run tag` performs a stream-copy-only MP4 remux (no re-encoding) so the
artifact metadata records the verified installed version, `0.8.10`.
The same stream-copy remux places the MP4 metadata atom before video data for
progressive-download playback.

## Final validation

The shipped reel was rendered and reviewed at 1920x1080, 30 fps, 17.4 seconds,
and 522 frames. It is a silent H.264 High Profile MP4 with `yuv420p` and BT.709
color metadata. HyperFrames lint/check report no errors or warnings, all 28
sampled text treatments pass WCAG AA contrast, and all 199 transition/layout
samples are clean. A full decode found no corrupt or black frames; frame hashes
found no adjacent duplicates. The silent, fast-start delivery is 6.0 MB.
