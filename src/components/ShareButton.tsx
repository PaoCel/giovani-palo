import { useEffect, useState } from "react";

import { AppIcon } from "@/components/AppIcon";
import { shareLink, type ShareResult } from "@/utils/share";

interface ShareButtonProps {
  title: string;
  text?: string;
  url: string;
  className?: string;
  iconOnly?: boolean;
  label?: string;
}

function getFeedbackLabel(result: ShareResult) {
  if (result === "copied") {
    return "Link copiato";
  }

  if (result === "shared") {
    return "Condivisione aperta";
  }

  return null;
}

export function ShareButton({
  title,
  text,
  url,
  className = "button button--ghost",
  iconOnly = false,
  label = "Condividi",
}: ShareButtonProps) {
  const [feedback, setFeedback] = useState<string | null>(null);

  useEffect(() => {
    if (!feedback) {
      return undefined;
    }

    const timeout = window.setTimeout(() => setFeedback(null), 2200);
    return () => window.clearTimeout(timeout);
  }, [feedback]);

  async function handleShare() {
    try {
      const result = await shareLink({ title, text, url });
      setFeedback(getFeedbackLabel(result));
    } catch {
      setFeedback("Link non copiato");
    }
  }

  const buttonLabel = feedback ?? label;

  return (
    <button
      aria-label={iconOnly ? buttonLabel : undefined}
      className={className}
      onClick={() => void handleShare()}
      title={buttonLabel}
      type="button"
    >
      <AppIcon name="share" />
      {iconOnly ? null : <span>{buttonLabel}</span>}
    </button>
  );
}
