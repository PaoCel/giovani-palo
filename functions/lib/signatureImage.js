const { PNG } = require("pngjs");

function getOpaqueBounds(png) {
  let minX = png.width;
  let minY = png.height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < png.height; y += 1) {
    for (let x = 0; x < png.width; x += 1) {
      const index = (png.width * y + x) << 2;
      const alpha = png.data[index + 3];
      if (alpha > 18) {
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }
  }

  if (maxX < minX || maxY < minY) {
    return null;
  }

  return { minX, minY, maxX, maxY };
}

function cropPng(png, bounds, padding = 16) {
  const left = Math.max(0, bounds.minX - padding);
  const top = Math.max(0, bounds.minY - padding);
  const right = Math.min(png.width - 1, bounds.maxX + padding);
  const bottom = Math.min(png.height - 1, bounds.maxY + padding);
  const width = right - left + 1;
  const height = bottom - top + 1;
  const cropped = new PNG({ width, height });

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const sourceIndex = (png.width * (top + y) + left + x) << 2;
      const targetIndex = (width * y + x) << 2;
      cropped.data[targetIndex] = png.data[sourceIndex];
      cropped.data[targetIndex + 1] = png.data[sourceIndex + 1];
      cropped.data[targetIndex + 2] = png.data[sourceIndex + 2];
      cropped.data[targetIndex + 3] = png.data[sourceIndex + 3];
    }
  }

  return cropped;
}

function sanitizeSignaturePng(inputBuffer) {
  if (!inputBuffer || !Buffer.isBuffer(inputBuffer)) {
    return inputBuffer;
  }

  try {
    const png = PNG.sync.read(inputBuffer);

    for (let y = 0; y < png.height; y += 1) {
      for (let x = 0; x < png.width; x += 1) {
        const index = (png.width * y + x) << 2;
        const red = png.data[index];
        const green = png.data[index + 1];
        const blue = png.data[index + 2];
        const alpha = png.data[index + 3];
        const isWhite = red > 242 && green > 242 && blue > 242;
        const isAlmostWhite = red > 232 && green > 232 && blue > 232;

        if (alpha === 0 || isWhite || isAlmostWhite) {
          png.data[index + 3] = 0;
        } else {
          png.data[index + 3] = Math.max(alpha, 220);
        }
      }
    }

    const bounds = getOpaqueBounds(png);
    if (!bounds) {
      return inputBuffer;
    }

    return PNG.sync.write(cropPng(png, bounds));
  } catch (error) {
    return inputBuffer;
  }
}

module.exports = {
  sanitizeSignaturePng,
};
