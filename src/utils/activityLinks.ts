export function getActivitiesPath(stakeId?: string) {
  const params = new URLSearchParams();

  if (stakeId) {
    params.set("stake", stakeId);
  }

  const query = params.toString();
  return `/activities${query ? `?${query}` : ""}`;
}

export function getActivityPath(eventId: string, stakeId?: string) {
  const params = new URLSearchParams();

  if (stakeId) {
    params.set("stake", stakeId);
  }

  const query = params.toString();
  return `/activities/${eventId}${query ? `?${query}` : ""}`;
}

export function getMyActivityPath(eventId: string) {
  return `/me/activities/${eventId}`;
}

export function getActivityRegistrationPath(eventId: string, stakeId?: string) {
  const params = new URLSearchParams();

  if (stakeId) {
    params.set("stake", stakeId);
  }

  const query = params.toString();
  return `/activities/${eventId}/register${query ? `?${query}` : ""}`;
}

export function getAbsoluteUrl(path: string) {
  if (typeof window === "undefined") {
    return path;
  }

  return new URL(path, window.location.origin).toString();
}
