// Pure URL helpers — safe for client. Reads NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME
// (or CLOUDINARY_CLOUD_NAME on the server) but never the API secret.

export function cloudinaryUrl(
  publicIdOrUrl: string,
  opts: { width?: number; height?: number; crop?: "fill" | "fit" | "thumb" } = {},
): string {
  if (publicIdOrUrl.startsWith("http")) {
    return transformExisting(publicIdOrUrl, opts);
  }
  const cloud =
    process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME ?? process.env.CLOUDINARY_CLOUD_NAME ?? "";
  const transforms = transformString(opts);
  return `https://res.cloudinary.com/${cloud}/image/upload/${transforms}/${publicIdOrUrl}`;
}

function transformString(opts: { width?: number; height?: number; crop?: string }): string {
  const parts: string[] = ["f_auto", "q_auto"];
  if (opts.width) parts.push(`w_${opts.width}`);
  if (opts.height) parts.push(`h_${opts.height}`);
  if (opts.crop) parts.push(`c_${opts.crop}`);
  if (opts.crop === "fill" || opts.crop === "thumb") parts.push("g_auto");
  return parts.join(",");
}

function transformExisting(
  url: string,
  opts: { width?: number; height?: number; crop?: string },
): string {
  // Inject transforms after `/upload/` if it's a cloudinary URL.
  const marker = "/upload/";
  const idx = url.indexOf(marker);
  if (idx === -1) return url;
  const before = url.slice(0, idx + marker.length);
  const after = url.slice(idx + marker.length);
  return `${before}${transformString(opts)}/${after}`;
}
