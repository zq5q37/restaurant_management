# Brand assets

`rokushichi-logo-master.png` — 1254 × 1254, the full lockup: gold enso circle, 六七 in ink,
cherry blossom, the 和食 seal, and the ROKUSHICHI · JAPANESE CUISINE wordmark on a gold-framed
paper ground. This is the source of truth. It is **not** served to the browser.

Everything the app actually loads lives in `frontend/public/` and is derived from this file:

| File | Size | What it is | Used by |
|---|---|---|---|
| `favicon-32.png` | 3 KB | enso crop, 32 px | the browser tab |
| `apple-touch-icon.png` | 72 KB | enso crop, 180 px | iOS home screen (must be PNG) |
| `logo-mark.webp` | 4 KB | enso crop, 96 px | the header wordmark, up to 3× |
| `logo-mark-512.webp` | 42 KB | enso crop, 512 px | PWA install, social cards |
| `logo-lockup.webp` | 68 KB | the whole artwork, 720 px | the sign-in screen |

## Regenerating them

There is no ImageMagick or `sharp` on this project, and adding a native image dependency for
five static files is not worth it. The derivatives were produced by cropping and downscaling
on an `OffscreenCanvas` in the browser, which has a better resampler than most CLI defaults.

The crop is the enso circle's bounding box, as fractions of the source so it survives a
change of master resolution:

```js
const CROP = { x: 0.16, y: 0.10, size: 0.728 };  // drops the gold paper frame only
```

PNG is used only where it is required (favicon, iOS) or genuinely small. The artwork is
textured paper, which defeats PNG badly — a 512 px PNG came out at 580 KB against 42 KB as
WebP — so everything else is WebP.

If you replace the master, the two things to check are that the crop still frames the enso,
and that `favicon-32.png` still reads at tab size. At 32 px the wordmark inside the circle is
inevitably a smudge; the gold ring and the ink strokes are what make it recognisable.
