export interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Upload, drop and paste share one local-only validation path. */
export async function readImageFile(file: File): Promise<{ imageBase64: string; imageMediaType: string }> {
  if (!/^image\/(png|jpeg|webp)$/.test(file.type) || file.size > 5_000_000 || !file.size) {
    throw new Error("Use a PNG, JPEG or WebP image under 5 MB.");
  }
  const bitmap = await createImageBitmap(file);
  const pixels = bitmap.width * bitmap.height;
  bitmap.close();
  if (pixels > 40_000_000) throw new Error("This image is too large. Use an image under 40 megapixels.");
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read this image. Try another file."));
    reader.onload = () => {
      try { resolve(dataUrlToPayload(String(reader.result))); } catch { reject(new Error("Could not read this image.")); }
    };
    reader.readAsDataURL(file);
  });
}

export function stopTracks(stream: MediaStream | null | undefined): void {
  if (!stream) return;
  for (const track of stream.getTracks()) {
    track.stop();
  }
}

export async function waitForVideo(video: HTMLVideoElement, signal?: AbortSignal): Promise<void> {
  if (video.readyState >= 2) return;
  await new Promise<void>((resolve, reject) => {
    const onReady = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error("Screen preview failed"));
    };
    const cleanup = () => {
      signal?.removeEventListener("abort", onError);
      video.removeEventListener("loadeddata", onReady);
      video.removeEventListener("error", onError);
    };
    video.addEventListener("loadeddata", onReady);
    video.addEventListener("error", onError);
    signal?.addEventListener("abort", onError, { once: true });
    if (signal?.aborted) onError();
  });
}

export async function captureOneFrame(
  getDisplayMedia: MediaDevices["getDisplayMedia"] = (...args) => navigator.mediaDevices.getDisplayMedia(...args),
  parentSignal?: AbortSignal,
): Promise<{ dataUrl: string; width: number; height: number }> {
  let stream: MediaStream | null = null;
  const video = document.createElement("video");
  const signal = AbortSignal.any([AbortSignal.timeout(30_000), ...(parentSignal ? [parentSignal] : [])]);
  const abort = () => stopTracks(stream);
  signal.addEventListener("abort", abort, { once: true });
  video.muted = true;
  video.playsInline = true;
  try {
    stream = await getDisplayMedia({
      video: true,
      audio: false,
    });
    signal.throwIfAborted();
    video.srcObject = stream;
    await video.play();
    await waitForVideo(video, signal);
    const width = video.videoWidth || 1280;
    const height = video.videoHeight || 720;
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Could not read the captured frame");
    context.drawImage(video, 0, 0, width, height);
    return { dataUrl: canvas.toDataURL("image/png"), width, height };
  } finally {
    signal.removeEventListener("abort", abort);
    video.pause();
    video.srcObject = null;
    stopTracks(stream);
  }
}

export function cropDataUrl(dataUrl: string, crop: CropRect): Promise<string> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement("canvas");
      const width = Math.max(1, Math.round(crop.width));
      const height = Math.max(1, Math.round(crop.height));
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d");
      if (!context) {
        reject(new Error("Could not crop the screenshot"));
        return;
      }
      context.drawImage(image, crop.x, crop.y, crop.width, crop.height, 0, 0, width, height);
      resolve(canvas.toDataURL("image/png"));
    };
    image.onerror = () => reject(new Error("Could not load the screenshot for crop"));
    image.src = dataUrl;
  });
}

export function dataUrlToPayload(dataUrl: string): { imageBase64: string; imageMediaType: string } {
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) throw new Error("Screenshot is not a data URL");
  return { imageMediaType: match[1], imageBase64: match[2] };
}

export function redactRect(dataUrl: string, rect: CropRect): Promise<string> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = image.width;
      canvas.height = image.height;
      const context = canvas.getContext("2d");
      if (!context) {
        reject(new Error("Could not redact the screenshot"));
        return;
      }
      context.drawImage(image, 0, 0);
      context.fillStyle = "#111827";
      context.fillRect(rect.x, rect.y, rect.width, rect.height);
      resolve(canvas.toDataURL("image/png"));
    };
    image.onerror = () => reject(new Error("Could not load the screenshot for redaction"));
    image.src = dataUrl;
  });
}
