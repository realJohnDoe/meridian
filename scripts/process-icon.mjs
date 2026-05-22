import sharp from 'sharp'

const { data, info } = await sharp('public/icon.png')
  .ensureAlpha()
  .raw()
  .toBuffer({ resolveWithObject: true })

const pixels = new Uint8ClampedArray(data)

for (let i = 0; i < pixels.length; i += 4) {
  if (pixels[i] > 248 && pixels[i + 1] > 248 && pixels[i + 2] > 248) {
    pixels[i + 3] = 0
  }
}

const { data: trimData, info: trimInfo } = await sharp(Buffer.from(pixels), {
  raw: { width: info.width, height: info.height, channels: 4 },
})
  .trim({ threshold: 10 })
  .raw()
  .toBuffer({ resolveWithObject: true })

const src = { raw: { width: trimInfo.width, height: trimInfo.height, channels: 4 } }

await Promise.all([
  sharp(trimData, src).resize(512, 512).png().toFile('public/icon-512.png'),
  sharp(trimData, src).resize(192, 192).png().toFile('public/icon-192.png'),
  sharp(trimData, src).resize(180, 180).png().toFile('public/icon-180.png'),
])

console.log('done')
