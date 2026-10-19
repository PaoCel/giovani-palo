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

// Iscrizione con la scelta "per chi" già fatta (`?per=figlio`): parte da
// "Il tuo account" o da "Chi iscrivi?" invece che da "Chi partecipa?".
export function withRegisterFor(registrationPath: string, per: "io" | "figlio") {
  const [pathname, query = ""] = registrationPath.split("?");
  const params = new URLSearchParams(query);
  params.set("per", per);
  return `${pathname}?${params.toString()}`;
}

// Pagina Accedi con ritorno a `redirect` (la pagina da cui si parte). Niente
// ritorno verso /login stessa né verso indirizzi che non sono un percorso
// interno. `scheda: "crea"` apre "Crea un account" invece di "Accedi".
export function getLoginPath(redirect?: string | null, scheda?: "crea") {
  const params = new URLSearchParams();

  if (scheda) {
    params.set("scheda", scheda);
  }

  if (
    redirect &&
    redirect.startsWith("/") &&
    !redirect.startsWith("//") &&
    !redirect.startsWith("/\\") &&
    !/^\/login(?:[/?#]|$)/u.test(redirect)
  ) {
    params.set("redirect", redirect);
  }

  const query = params.toString();
  return `/login${query ? `?${query}` : ""}`;
}

// Notte dei Record dell'attività (docs/NOTTE_DEI_RECORD.md).
export function getRecordNightPath(eventId: string, stakeId?: string) {
  const params = new URLSearchParams();

  if (stakeId) {
    params.set("stake", stakeId);
  }

  const query = params.toString();
  return `/activities/${eventId}/record${query ? `?${query}` : ""}`;
}

// true se `path` (anche con query o hash) è la pagina pubblica della Notte dei
// Record di un'attività, `/activities/<id>/record`. Non la pagina di gestione.
export function isRecordNightPath(path: string | null | undefined) {
  return typeof path === "string" && /^\/activities\/[^/?#]+\/record\/?(?:[?#]|$)/u.test(path);
}

export function getAbsoluteUrl(path: string) {
  if (typeof window === "undefined") {
    return path;
  }

  return new URL(path, window.location.origin).toString();
}
