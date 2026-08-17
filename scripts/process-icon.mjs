import sharp from 'sharp'

// Source is an iOS-style rounded-square icon sitting on a pure black field. We
// knock out that field so the rounded corners become transparent, matching how
// the icon renders elsewhere in the app.
//
// The body itself can dip into near-black tones near its edges (e.g. a glow
// vignette), so a global luminance threshold would wrongly punch holes in the
// design. Instead we flood-fill from the four image corners through
// near-black pixels only — this reaches the corner cutouts (which touch the
// corners) without touching similarly dark pixels deeper inside the body.
const THRESHOLD = 4 // max channel at/below this counts as "field" during flood fill

const { data, info } = await sharp('assets/icon.png')
  .ensureAlpha()
  .raw()
  .toBuffer({ resolveWithObject: true })

const pixels = new Uint8ClampedArray(data)
const { width, height } = info
const isField = (i) => Math.max(pixels[i], pixels[i + 1], pixels[i + 2]) <= THRESHOLD

const visited = new Uint8Array(width * height)
const stack = []
for (const [x, y] of [
  [0, 0],
  [width - 1, 0],
  [0, height - 1],
  [width - 1, height - 1],
]) {
  const p = y * width + x
  visited[p] = 1
  stack.push(p)
}

while (stack.length) {
  const p = stack.pop()
  const i = p * 4
  if (!isField(i)) continue
  pixels[i + 3] = 0

  const x = p % width
  const y = (p - x) / width
  const neighbors = []
  if (x > 0) neighbors.push(p - 1)
  if (x < width - 1) neighbors.push(p + 1)
  if (y > 0) neighbors.push(p - width)
  if (y < height - 1) neighbors.push(p + width)
  for (const n of neighbors) {
    if (!visited[n]) {
      visited[n] = 1
      stack.push(n)
    }
  }
}

const src = { raw: { width: info.width, height: info.height, channels: 4 } }

await Promise.all([
  sharp(pixels, src).resize(512, 512).png().toFile('public/icon-512.png'),
  sharp(pixels, src).resize(192, 192).png().toFile('public/icon-192.png'),
  sharp(pixels, src).resize(180, 180).png().toFile('public/icon-180.png'),
])

console.log('done')
