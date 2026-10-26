const { createHmac } = require("node:crypto");

const PRODUCTION_BUCKETS = Object.freeze(["giovani-palo-eu", "giovani-palo.firebasestorage.app"]);
function resolveMediaBucketNames({ projectId, emulator, defaultBucketName }) {
  if (projectId === "giovani-palo" && !emulator) return [...PRODUCTION_BUCKETS];
  if (!defaultBucketName || PRODUCTION_BUCKETS.includes(defaultBucketName)) {
    throw new Error("Bucket non di produzione non configurato.");
  }
  return [defaultBucketName];
}
function mediaFolder(stakeId, galleryId, mediaId) {
  for (const id of [stakeId, galleryId, mediaId]) {
    if (typeof id !== "string" || !id || id.includes("/") || id === "." || id === "..") throw new Error("Identificatore media non valido.");
  }
  return `protected/stakes/${stakeId}/galleries/${galleryId}/media/${mediaId}/`;
}
function rewriteMediaDownloadUrl(url, { tokensByPath, bucketNames, prefix, emulatorHost }) {
  if (typeof url !== "string") return url;
  try {
    const parsed = new URL(url);
    const productionHost = parsed.protocol === "https:" && parsed.host === "firebasestorage.googleapis.com";
    const localHost = emulatorHost && parsed.protocol === "http:" && parsed.host === emulatorHost;
    if (!productionHost && !localHost) return url;
    const match = parsed.pathname.match(/^\/v0\/b\/([^/]+)\/o\/(.+)$/);
    if (!match || !bucketNames.includes(decodeURIComponent(match[1]))) return url;
    const path = decodeURIComponent(match[2]);
    if (!path.startsWith(prefix) || !Object.hasOwn(tokensByPath, path)) return url;
    parsed.searchParams.set("token", tokensByPath[path]);
    return parsed.toString();
  } catch { return url; }
}
function createGalleryMediaStorage({ storage, bucketNames }) {
  const names = [...new Set(bucketNames)];
  if (!names.length) throw new Error("Nessun bucket configurato.");
  async function acrossBuckets(action) {
    const results = await Promise.allSettled(names.map((name) => action(storage.bucket(name))));
    if (results.some((result) => result.status === "rejected")) {
      const error = new Error("Operazione Storage incompleta; riprovare.");
      error.code = "storage-cleanup-incomplete";
      error.retryable = true;
      throw error;
    }
  }
  return {
    async revokeMedia({ stakeId, galleryId, mediaId, rotationSeed, isCurrent = async () => true }) {
      if (typeof rotationSeed !== "string" || !rotationSeed) throw new Error("Seed revoca mancante.");
      const prefix = mediaFolder(stakeId, galleryId, mediaId);
      const tokensByPath = Object.create(null);
      await acrossBuckets(async (bucket) => {
        const [files] = await bucket.getFiles({ prefix });
        for (const file of files) {
          if (!file.name.startsWith(prefix)) throw new Error("Oggetto fuori prefisso.");
          const token = createHmac("sha256", rotationSeed).update(file.name).digest("hex");
          try {
            const [metadata] = await file.getMetadata();
            if (!await isCurrent()) throw new Error("Revoca superata da un'altra operazione.");
            await file.setMetadata({ metadata: { ...metadata.metadata, firebaseStorageDownloadTokens: token } },
              { ifGenerationMatch: metadata.generation, ifMetagenerationMatch: metadata.metageneration });
            tokensByPath[file.name] = token;
          } catch (error) {
            if (Number(error?.code) !== 404) throw error;
          }
        }
      });
      return { tokensByPath, bucketNames: names };
    },
    async deleteMedia({ stakeId, galleryId, mediaId }) {
      const prefix = mediaFolder(stakeId, galleryId, mediaId);
      await acrossBuckets((bucket) => bucket.deleteFiles({ prefix }));
      return { bucketNames: names };
    },
  };
}
module.exports = { resolveMediaBucketNames, mediaFolder, rewriteMediaDownloadUrl, createGalleryMediaStorage };
