import "server-only";
import {
  S3Client,
  DeleteObjectCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { randomUUID } from "crypto";

let cached: S3Client | null = null;
function getClient(): S3Client {
  if (cached) return cached;
  const region = process.env.AWS_REGION;
  if (!region) throw new Error("AWS_REGION is not set");
  cached = new S3Client({
    region,
    credentials:
      process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY
        ? {
            accessKeyId: process.env.AWS_ACCESS_KEY_ID,
            secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
          }
        : undefined, // fall back to instance role (e.g., EC2/ECS) if no static keys.
  });
  return cached;
}

export function isS3Configured(): boolean {
  return Boolean(process.env.AWS_REGION && process.env.S3_BUCKET);
}

function s3Bucket(): string {
  const b = process.env.S3_BUCKET;
  if (!b) throw new Error("S3_BUCKET is not set");
  return b;
}

// Public URL for an object. Honors S3_PUBLIC_BASE_URL if you front the bucket
// with CloudFront or a custom domain; otherwise builds a virtual-hosted style
// URL like https://{bucket}.s3.{region}.amazonaws.com/{key}.
export function publicUrlForKey(key: string): string {
  const base = process.env.S3_PUBLIC_BASE_URL;
  if (base) {
    return `${base.replace(/\/$/, "")}/${key}`;
  }
  const bucket = s3Bucket();
  const region = process.env.AWS_REGION!;
  return `https://${bucket}.s3.${region}.amazonaws.com/${key}`;
}

export type PresignedPutResult = {
  uploadUrl: string;
  key: string;
  publicUrl: string;
  contentType: string;
  expiresIn: number;
};

const ALLOWED_CONTENT_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/heic",
  "image/heif",
  "image/webp",
]);

function extFromContentType(ct: string): string {
  switch (ct) {
    case "image/jpeg":
      return "jpg";
    case "image/png":
      return "png";
    case "image/heic":
      return "heic";
    case "image/heif":
      return "heif";
    case "image/webp":
      return "webp";
    default:
      return "bin";
  }
}

export async function presignPhotoPut(
  prefix: string,
  contentType: string,
): Promise<PresignedPutResult> {
  if (!ALLOWED_CONTENT_TYPES.has(contentType)) {
    throw new Error(`Unsupported content type: ${contentType}`);
  }
  const ext = extFromContentType(contentType);
  const key = `${prefix.replace(/^\/+|\/+$/g, "")}/${randomUUID()}.${ext}`;
  const cmd = new PutObjectCommand({
    Bucket: s3Bucket(),
    Key: key,
    ContentType: contentType,
  });
  const uploadUrl = await getSignedUrl(getClient(), cmd, { expiresIn: 300 });
  return {
    uploadUrl,
    key,
    publicUrl: publicUrlForKey(key),
    contentType,
    expiresIn: 300,
  };
}

export async function deleteObject(key: string): Promise<void> {
  try {
    await getClient().send(
      new DeleteObjectCommand({ Bucket: s3Bucket(), Key: key }),
    );
  } catch (err) {
    console.error("[s3] delete failed", err);
  }
}
