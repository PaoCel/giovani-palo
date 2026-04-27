interface StatCardProps {
  label: string;
  value: string | number;
  description: string;
}

export function StatCard({ label, value, description }: StatCardProps) {
  return (
    <article className="stat-card">
      <span className="stat-card__label">{label}</span>
      <strong className="stat-card__value">{value}</strong>
      <p className="stat-card__description">{description}</p>
    </article>
  );
}
