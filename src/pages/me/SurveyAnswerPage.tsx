import { useParams } from "react-router-dom";

import { SurveyAnswerView } from "@/components/survey/SurveyAnswerView";
import { useAuth } from "@/hooks/useAuth";

const STAKE_ID = "roma-est";

export function SurveyAnswerPage() {
  const { eventId } = useParams<{ eventId: string }>();
  const { session } = useAuth();
  const stakeId = session?.profile.stakeId || STAKE_ID;

  if (!eventId) {
    return null;
  }

  return <SurveyAnswerView stakeId={stakeId} eventId={eventId} backHref="/me" />;
}
