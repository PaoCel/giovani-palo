import { getFunctions, httpsCallable } from "firebase/functions";

import { firebaseApp } from "@/services/firebase/app";

const FUNCTIONS_REGION = "europe-west1";

export interface UnlockGalleryRequest {
  stakeId: string;
  galleryId: string;
  code: string;
}

export interface UnlockGalleryResult {
  success: boolean;
  errorCode?: "invalid_code" | "not_found" | "auth_required" | "unknown";
  message?: string;
}

export const galleryUnlockService = {
  async unlock(request: UnlockGalleryRequest): Promise<UnlockGalleryResult> {
    const trimmed = request.code.trim();
    if (!trimmed) {
      return { success: false, errorCode: "invalid_code", message: "Codice mancante." };
    }

    try {
      const functions = getFunctions(firebaseApp, FUNCTIONS_REGION);
      const callable = httpsCallable<
        { stakeId: string; galleryId: string; code: string },
        { success: boolean; errorCode?: string; message?: string }
      >(functions, "unlockGalleryWithCode");
      const response = await callable({
        stakeId: request.stakeId,
        galleryId: request.galleryId,
        code: trimmed,
      });
      const data = response.data;
      if (data.success) return { success: true };
      return {
        success: false,
        errorCode:
          data.errorCode === "invalid_code"
            ? "invalid_code"
            : data.errorCode === "not_found"
              ? "not_found"
              : data.errorCode === "auth_required"
                ? "auth_required"
                : "unknown",
        message: data.message ?? "Codice non valido.",
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Errore sconosciuto.";
      if (message.toLowerCase().includes("invalid_code")) {
        return { success: false, errorCode: "invalid_code", message: "Codice non valido." };
      }
      if (message.toLowerCase().includes("not_found")) {
        return { success: false, errorCode: "not_found", message: "Galleria non trovata." };
      }
      if (message.toLowerCase().includes("unauthenticated")) {
        return { success: false, errorCode: "auth_required", message: "Devi accedere per sbloccare la galleria." };
      }
      return { success: false, errorCode: "unknown", message };
    }
  },
};
