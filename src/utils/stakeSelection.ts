import { stakesService } from "@/services/firestore/stakesService";

const PUBLIC_STAKE_KEY = "agenda-viaggio-tempio.public-stake";

function canUseStorage() {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

export function getStoredPublicStakeId() {
  if (!canUseStorage()) {
    return "";
  }

  return window.localStorage.getItem(PUBLIC_STAKE_KEY) ?? "";
}

export function storePublicStakeId(stakeId: string) {
  if (!canUseStorage()) {
    return;
  }

  if (!stakeId) {
    window.localStorage.removeItem(PUBLIC_STAKE_KEY);
    return;
  }

  window.localStorage.setItem(PUBLIC_STAKE_KEY, stakeId);
}

export async function resolvePublicStakeId(preferredStakeId?: string) {
  if (preferredStakeId) {
    const preferredStake = await stakesService.getStakeById(preferredStakeId);

    if (preferredStake?.isActive) {
      storePublicStakeId(preferredStake.id);
      return preferredStake.id;
    }
  }

  const storedStakeId = getStoredPublicStakeId();

  if (storedStakeId) {
    const storedStake = await stakesService.getStakeById(storedStakeId);

    if (storedStake?.isActive) {
      return storedStake.id;
    }
  }

  const defaultStakeId = await stakesService.getDefaultStakeId();
  storePublicStakeId(defaultStakeId);
  return defaultStakeId;
}
