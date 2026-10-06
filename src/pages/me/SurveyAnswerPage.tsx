import { useParams } from "react-router-dom";

import { SurveyAnswerView } from "@/components/survey/SurveyAnswerView";
import { useAuth } from "@/hooks/useAuth";
import { DEFAULT_STAKE_ID } from "@/config/app";

export function SurveyAnswerPage() {
  const { eventId } = useParams<{ eventId: string }>();
  const { session } = useAuth();
  const stakeId = session?.profile.stakeId || DEFAULT_STAKE_ID;

  if (!eventId) {
    return null;
  }

  return <SurveyAnswerView stakeId={stakeId} eventId={eventId} backHref="/me" />;
}
