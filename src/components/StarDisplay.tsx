interface StarDisplayProps {
  value: number;
  max?: number;
  size?: "sm" | "md" | "lg";
  showValue?: boolean;
}

export function StarDisplay({
  value,
  max = 5,
  size = "md",
  showValue = false,
}: StarDisplayProps) {
  const stars = Array.from({ length: max }, (_, index) => index + 1);
  return (
    <div className={`star-display star-display--${size}`} aria-label={`${value} su ${max}`}>
      <div className="star-display__row">
        {stars.map((star) => {
          const filled =
            value >= star ? "full" : value >= star - 0.5 ? "half" : "empty";
          return (
            <span
              key={star}
              className={`star-display__star star-display__star--${filled}`}
              aria-hidden="true"
            >
              <span className="star-display__background">★</span>
              <span className="star-display__foreground">★</span>
            </span>
          );
        })}
      </div>
      {showValue ? (
        <span className="star-display__value">
          {value.toFixed(1)}<span className="star-display__max">/{max}</span>
        </span>
      ) : null}
    </div>
  );
}
