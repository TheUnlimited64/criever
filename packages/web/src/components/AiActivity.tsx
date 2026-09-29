export function AiActivity({ label }: { readonly label: string }) {
  return <span className="ai-activity" role="status" aria-label={label}>
    <span className="ai-activity-dots" aria-hidden="true"><i /><i /><i /></span>
    <span>{label}</span>
  </span>;
}
