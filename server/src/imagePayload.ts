/** Image payload helpers. See LICENSE. */

export interface ImagePayload {
  data: string;
  mediaType: string;
}

export function requestHasImage(image?: ImagePayload | null): boolean {
  return Boolean(image?.data?.trim());
}

export function toImageDataUrl(image: ImagePayload): string {
  const mediaType = image.mediaType.trim() || "image/png";
  return `data:${mediaType};base64,${image.data}`;
}
