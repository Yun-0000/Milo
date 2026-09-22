/** Validate both text and voice image inputs before any paid model request. */
export function validImageInput(data: unknown, mediaType: unknown = "image/png"): boolean {
  if (data === undefined || data === "") return true;
  if (typeof data !== "string" || typeof mediaType !== "string" || data.length > 6_666_668 || !/^[A-Za-z0-9+/]+={0,2}$/.test(data)) return false;
  const bytes = Buffer.from(data, "base64");
  if (!bytes.length || bytes.length > 5_000_000 || bytes.toString("base64") !== data) return false;
  if (mediaType === "image/png") return bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (mediaType === "image/jpeg") return bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  if (mediaType === "image/webp") return bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP";
  return false;
}
