export type BadgeStatus =
  | "planned" | "in-progress" | "done" | "blocked" | "canceled"
  | "draft" | "discovery";

interface Props {
  status: BadgeStatus;
  className?: string;
}

export function Badge({ status, className = "" }: Props) {
  return (
    <span className={`badge status-${status} ${className}`}>
      {status}
    </span>
  );
}
