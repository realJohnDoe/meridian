import sharp from 'sharp'

// Source is an iOS-style rounded-square icon (navy body, cream "M") sitting on a
// black field. We knock out that black field so the rounded corners become
// transparent, matching how the icon renders elsewhere in the app.
//
// The body's darkest colour is the navy fill (max channel ≈ 48), while the field
// is pure black (max channel ≈ 0). We map the per-pixel max channel through a
// ramp so the field goes fully transparent and the antialiased corner edge is
// feathered instead of left with a hard fringe.
const LO = 10 // max channel at/below this → fully transparent
const HI = 44 // max channel at/above this → fully opaque (navy and brighter)

const { data, info } = await sharp('public/icon.png')
  .ensureAlpha()
  .raw()
  .toBuffer({ resolveWithObject: true })

const pixels = new Uint8ClampedArray(data)

for (let i = 0; i < pixels.length; i += 4) {
  const max = Math.max(pixels[i], pixels[i + 1], pixels[i + 2])
  if (max <= LO) {
    pixels[i + 3] = 0
  } else if (max < HI) {
    pixels[i + 3] = Math.round(((max - LO) / (HI - LO)) * 255)
  }
}

const src = { raw: { width: info.width, height: info.height, channels: 4 } }

await Promise.all([
  sharp(pixels, src).resize(512, 512).png().toFile('public/icon-512.png'),
  sharp(pixels, src).resize(192, 192).png().toFile('public/icon-192.png'),
  sharp(pixels, src).resize(180, 180).png().toFile('public/icon-180.png'),
])

console.log('done')
