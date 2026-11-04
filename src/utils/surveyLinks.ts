const SURVEYS = [{
  slug: "tempio-ottobre-2026",
  stakeId: "roma-est",
  eventId: "55FjHkqgib55rNXfgVk9",
}] as const;

export function getSurveyBySlug(slug: string) {
  return SURVEYS.find(survey => survey.slug === slug) ?? null;
}

/** Sondaggio aperto a tutti (/sondaggio/:slug), anche senza account. */
export function hasPublicSurvey(eventId: string) {
  return SURVEYS.some(item => item.eventId === eventId);
}

export function getSurveyHref(eventId: string): string {
  const survey = SURVEYS.find(item => item.eventId === eventId);
  return survey ? `/sondaggio/${survey.slug}` : `/campeggio/${encodeURIComponent(eventId)}?tab=sondaggio`;
}
