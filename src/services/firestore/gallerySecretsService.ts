import { getFunctions, httpsCallable } from "firebase/functions";

import { firebaseApp } from "@/services/firebase/app";
import { galleriesService } from "@/services/firestore/galleriesService";

const FUNCTIONS_REGION = "europe-west1";

const SAFE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export const gallerySecretsService = {
  generateReadableCode(prefix = "GAL"): string {
    const groupA = randomBlock(4);
    const groupB = randomBlock(3);
    return `${prefix}-${groupA}-${groupB}`;
  },

  async setGalleryCode(args: {
    stakeId: string;
    galleryId: string;
    code: string;
  }): Promise<void> {
    const functions = getFunctions(firebaseApp, FUNCTIONS_REGION);
    const callable = httpsCallable<
      { stakeId: string; galleryId: string; code: string },
      { success: boolean }
    >(functions, "setGallerySecretCode");
    await callable({
      stakeId: args.stakeId,
      galleryId: args.galleryId,
      code: args.code.trim().toUpperCase(),
    });
    await galleriesService
      .markCodeStatus(args.stakeId, args.galleryId, "set")
      .catch(() => undefined);
  },
};

function randomBlock(length: number) {
  const cryptoSource = globalThis.crypto;
  const bytes = new Uint8Array(length);
  if (cryptoSource && typeof cryptoSource.getRandomValues === "function") {
    cryptoSource.getRandomValues(bytes);
  } else {
    for (let i = 0; i < length; i += 1) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  let out = "";
  for (let i = 0; i < length; i += 1) {
    out += SAFE_ALPHABET[bytes[i] % SAFE_ALPHABET.length];
  }
  return out;
}
