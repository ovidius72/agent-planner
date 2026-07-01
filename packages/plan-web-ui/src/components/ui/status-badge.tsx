export function StatusBadge({ status }: { status: string }) {
  return <span className={`status-chip status-${status}`}>{status}</span>;
}
