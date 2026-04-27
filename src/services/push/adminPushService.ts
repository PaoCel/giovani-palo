import { deleteDoc, doc, getDoc, setDoc } from "firebase/firestore";

import { db } from "@/services/firebase/app";
import { webPushPublicKey } from "@/services/firebase/config";
import type { AdminPushDevice, AdminPushSubscription, PushPermissionState, UserRole } from "@/types";

const DEVICE_STORAGE_KEY = "gugd-admin-push-device-id";
const LAST_STAKE_STORAGE_KEY = "gugd-admin-push-last-stake";

export interface AdminPushStatus {
  supported: boolean;
  permission: PushPermissionState;
  subscribed: boolean;
  requiresStandaloneInstall: boolean;
}

interface SyncAdminPushArgs {
  stakeId: string;
  userId: string;
  userName: string;
  role: UserRole;
}

function nowIso() {
  return new Date().toISOString();
}

function getPermissionState(): PushPermissionState {
  if (typeof window === "undefined" || !("Notification" in window)) {
    return "unsupported";
  }

  return window.Notification.permission;
}

function isStandaloneMode() {
  if (typeof window === "undefined") {
    return false;
  }

  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

function isAppleMobile() {
  if (typeof navigator === "undefined") {
    return false;
  }

  return /iPhone|iPad|iPod/i.test(navigator.userAgent);
}

function isPushSupported() {
  return (
    typeof window !== "undefined" &&
    window.isSecureContext &&
    "Notification" in window &&
    "serviceWorker" in navigator &&
    "PushManager" in window
  );
}

function requiresStandaloneInstall() {
  return isAppleMobile() && !isStandaloneMode();
}

function getStoredDeviceId() {
  if (typeof window === "undefined") {
    return null;
  }

  return window.localStorage.getItem(DEVICE_STORAGE_KEY);
}

function getOrCreateDeviceId() {
  if (typeof window === "undefined") {
    return "";
  }

  const existing = window.localStorage.getItem(DEVICE_STORAGE_KEY);

  if (existing) {
    return existing;
  }

  const nextId = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

  window.localStorage.setItem(DEVICE_STORAGE_KEY, nextId);
  return nextId;
}

function rememberStakeId(stakeId: string) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(LAST_STAKE_STORAGE_KEY, stakeId);
}

function getRememberedStakeId() {
  if (typeof window === "undefined") {
    return null;
  }

  return window.localStorage.getItem(LAST_STAKE_STORAGE_KEY);
}

function clearRememberedStakeId() {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.removeItem(LAST_STAKE_STORAGE_KEY);
}

function getDeviceReference(stakeId: string, deviceId: string) {
  return doc(db, "stakes", stakeId, "adminPushDevices", deviceId);
}

function urlBase64ToUint8Array(base64String: string) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const normalizedBase64 = `${base64String}${padding}`
    .replace(/-/g, "+")
    .replace(/_/g, "/");
  const rawData = window.atob(normalizedBase64);

  return Uint8Array.from(rawData, (character) => character.charCodeAt(0));
}

function serializeSubscription(subscription: PushSubscription): AdminPushSubscription {
  const payload = subscription.toJSON();

  return {
    endpoint: payload.endpoint || "",
    expirationTime:
      typeof payload.expirationTime === "number" ? payload.expirationTime : null,
    keys: {
      auth: payload.keys?.auth || "",
      p256dh: payload.keys?.p256dh || "",
    },
  };
}

function createDevicePayload(
  args: SyncAdminPushArgs,
  subscription: PushSubscription,
  existing?: {
    createdAt?: string;
    lastDeliveredAt?: string | null;
    lastError?: string | null;
  },
): AdminPushDevice {
  const timestamp = nowIso();

  return {
    id: getOrCreateDeviceId(),
    stakeId: args.stakeId,
    userId: args.userId,
    userName: args.userName,
    role: args.role === "super_admin" ? "super_admin" : "admin",
    permission: getPermissionState(),
    subscription: serializeSubscription(subscription),
    userAgent: typeof navigator === "undefined" ? "" : navigator.userAgent,
    platform: typeof navigator === "undefined" ? "" : navigator.platform,
    isStandalone: isStandaloneMode(),
    createdAt: existing?.createdAt || timestamp,
    updatedAt: timestamp,
    lastSeenAt: timestamp,
    lastDeliveredAt: existing?.lastDeliveredAt ?? null,
    lastError: existing?.lastError ?? null,
  };
}

async function ensureServiceWorkerRegistration() {
  if (!("serviceWorker" in navigator)) {
    throw new Error("Questo browser non supporta i service worker.");
  }

  let registration = await navigator.serviceWorker.getRegistration();

  if (!registration) {
    if (!import.meta.env.PROD) {
      throw new Error(
        "Le notifiche push sono disponibili dopo il deploy su Hosting HTTPS.",
      );
    }

    registration = await navigator.serviceWorker.register("/sw.js");
  }

  await navigator.serviceWorker.ready;
  return registration;
}

async function getCurrentSubscription() {
  if (!isPushSupported()) {
    return null;
  }

  const registration = await navigator.serviceWorker.getRegistration();
  return registration?.pushManager.getSubscription() || null;
}

async function ensureCurrentSubscription() {
  const registration = await ensureServiceWorkerRegistration();
  let subscription = await registration.pushManager.getSubscription();

  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(webPushPublicKey),
    });
  }

  return subscription;
}

async function upsertCurrentDevice(args: SyncAdminPushArgs, subscription: PushSubscription) {
  const deviceId = getOrCreateDeviceId();
  const reference = getDeviceReference(args.stakeId, deviceId);
  const existingSnapshot = await getDoc(reference);
  const existing = existingSnapshot.exists()
    ? (existingSnapshot.data() as Partial<AdminPushDevice>)
    : null;

  await setDoc(reference, createDevicePayload(args, subscription, {
    createdAt:
      existing && typeof existing.createdAt === "string" ? existing.createdAt : undefined,
    lastDeliveredAt:
      existing && typeof existing.lastDeliveredAt === "string"
        ? existing.lastDeliveredAt
        : null,
    lastError:
      existing && typeof existing.lastError === "string" ? existing.lastError : null,
  }), {
    merge: true,
  });
  rememberStakeId(args.stakeId);
}

async function removeCurrentDeviceDocument(stakeId?: string) {
  const rememberedStakeId = stakeId || getRememberedStakeId();
  const deviceId = getStoredDeviceId();

  if (!rememberedStakeId || !deviceId) {
    clearRememberedStakeId();
    return;
  }

  await deleteDoc(getDeviceReference(rememberedStakeId, deviceId)).catch(() => undefined);
  clearRememberedStakeId();
}

export const adminPushService = {
  async getStatus(): Promise<AdminPushStatus> {
    if (!isPushSupported()) {
      return {
        supported: false,
        permission: getPermissionState(),
        subscribed: false,
        requiresStandaloneInstall: requiresStandaloneInstall(),
      };
    }

    const subscription = await getCurrentSubscription();

    return {
      supported: true,
      permission: getPermissionState(),
      subscribed: Boolean(subscription),
      requiresStandaloneInstall: requiresStandaloneInstall(),
    };
  },

  async enableCurrentDevice(args: SyncAdminPushArgs): Promise<AdminPushStatus> {
    if (!isPushSupported()) {
      return this.getStatus();
    }

    if (requiresStandaloneInstall()) {
      throw new Error(
        "Su iPhone e iPad devi prima installare l'app dalla Home per attivare le notifiche push.",
      );
    }

    const permission = await window.Notification.requestPermission();

    if (permission !== "granted") {
      await removeCurrentDeviceDocument(args.stakeId);
      return this.getStatus();
    }

    const subscription = await ensureCurrentSubscription();
    await upsertCurrentDevice(args, subscription);
    return this.getStatus();
  },

  async syncCurrentDevice(args: SyncAdminPushArgs) {
    if (!isPushSupported()) {
      return this.getStatus();
    }

    if (getPermissionState() !== "granted") {
      await removeCurrentDeviceDocument(args.stakeId);
      return this.getStatus();
    }

    let subscription = await getCurrentSubscription();

    if (!subscription) {
      if (requiresStandaloneInstall()) {
        await removeCurrentDeviceDocument(args.stakeId);
        return this.getStatus();
      }

      try {
        subscription = await ensureCurrentSubscription();
      } catch {
        await removeCurrentDeviceDocument(args.stakeId);
        return this.getStatus();
      }
    }

    await upsertCurrentDevice(args, subscription);
    return this.getStatus();
  },

  async disableCurrentDevice(stakeId?: string) {
    const subscription = await getCurrentSubscription().catch(() => null);

    if (subscription) {
      await subscription.unsubscribe().catch(() => undefined);
    }

    await removeCurrentDeviceDocument(stakeId);
    return this.getStatus();
  },
};
