export interface CompressedImage {
  blob: Blob;
  width: number;
  height: number;
  contentType: string;
}

interface CompressOptions {
  maxWidth: number;
  maxHeight?: number;
  quality: number;
  outputType?: "image/jpeg" | "image/webp";
}

const DEFAULT_OUTPUT = "image/jpeg";

async function loadBitmap(file: Blob): Promise<{ source: ImageBitmap | HTMLImageElement; width: number; height: number; cleanup: () => void }> {
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(file);
      return {
        source: bitmap,
        width: bitmap.width,
        height: bitmap.height,
        cleanup: () => {
          if (typeof bitmap.close === "function") bitmap.close();
        },
      };
    } catch {
      // fall back to HTMLImageElement
    }
  }
  const url = URL.createObjectURL(file);
  const image = new Image();
  image.decoding = "async";
  image.crossOrigin = "anonymous";
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error("Impossibile decodificare l'immagine."));
    image.src = url;
  });
  return {
    source: image,
    width: image.naturalWidth || image.width,
    height: image.naturalHeight || image.height,
    cleanup: () => {
      URL.revokeObjectURL(url);
    },
  };
}

function computeTargetSize(
  width: number,
  height: number,
  maxWidth: number,
  maxHeight?: number,
) {
  const ratio = width / Math.max(1, height);
  let targetWidth = Math.min(width, maxWidth);
  let targetHeight = Math.round(targetWidth / ratio);
  if (maxHeight && targetHeight > maxHeight) {
    targetHeight = maxHeight;
    targetWidth = Math.round(targetHeight * ratio);
  }
  return { width: targetWidth, height: targetHeight };
}

async function canvasToBlob(
  canvas: HTMLCanvasElement,
  type: string,
  quality: number,
): Promise<Blob> {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error("Compressione immagine fallita."));
      },
      type,
      quality,
    );
  });
}

export async function compressImage(
  file: Blob,
  options: CompressOptions,
): Promise<CompressedImage> {
  const { source, width, height, cleanup } = await loadBitmap(file);
  try {
    const target = computeTargetSize(width, height, options.maxWidth, options.maxHeight);
    const canvas = document.createElement("canvas");
    canvas.width = target.width;
    canvas.height = target.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D non disponibile.");
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    if (source instanceof HTMLImageElement) {
      ctx.drawImage(source, 0, 0, target.width, target.height);
    } else {
      ctx.drawImage(source, 0, 0, target.width, target.height);
    }
    const outputType = options.outputType ?? DEFAULT_OUTPUT;
    const blob = await canvasToBlob(canvas, outputType, options.quality);
    return {
      blob,
      width: target.width,
      height: target.height,
      contentType: outputType,
    };
  } finally {
    cleanup();
  }
}

export async function buildImageDerivatives(file: File) {
  const optimized = await compressImage(file, {
    maxWidth: 1600,
    quality: 0.78,
    outputType: "image/jpeg",
  });
  const thumbnail = await compressImage(file, {
    maxWidth: 400,
    quality: 0.7,
    outputType: "image/jpeg",
  });
  return { optimized, thumbnail };
}

export async function captureVideoPoster(file: File): Promise<CompressedImage | null> {
  if (!file.type.startsWith("video/")) return null;
  const url = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.preload = "auto";
  video.muted = true;
  video.playsInline = true;
  video.src = url;
  try {
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const finish = (cb: () => void) => {
        if (settled) return;
        settled = true;
        cb();
      };
      const onLoaded = () => finish(resolve);
      const onError = () => finish(() => reject(new Error("Impossibile leggere il video.")));
      video.addEventListener("loadeddata", onLoaded, { once: true });
      video.addEventListener("error", onError, { once: true });
      // Hard timeout: alcune codifiche / Safari iOS non emettono 'loadeddata'.
      // Skippiamo il poster invece di bloccare l'upload.
      window.setTimeout(() => finish(() => reject(new Error("poster_timeout_loadeddata"))), 4000);
    });
    if (video.duration && Number.isFinite(video.duration)) {
      try {
        video.currentTime = Math.min(0.4, video.duration * 0.1);
        await new Promise<void>((resolve) => {
          let done = false;
          const finish = () => {
            if (done) return;
            done = true;
            resolve();
          };
          video.addEventListener("seeked", finish, { once: true });
          window.setTimeout(finish, 1500);
        });
      } catch {
        // ignore seek failures and keep first frame
      }
    }
    const width = video.videoWidth;
    const height = video.videoHeight;
    if (!width || !height) return null;
    const canvas = document.createElement("canvas");
    const ratio = width / height;
    const targetWidth = Math.min(width, 800);
    const targetHeight = Math.round(targetWidth / ratio);
    canvas.width = targetWidth;
    canvas.height = targetHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, targetWidth, targetHeight);
    const blob: Blob | null = await new Promise((resolve) =>
      canvas.toBlob((value) => resolve(value), "image/jpeg", 0.72),
    );
    if (!blob) return null;
    return {
      blob,
      width: targetWidth,
      height: targetHeight,
      contentType: "image/jpeg",
    };
  } finally {
    URL.revokeObjectURL(url);
    video.src = "";
  }
}
