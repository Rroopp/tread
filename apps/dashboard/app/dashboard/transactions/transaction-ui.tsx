export function StatusBadge({ status }: { status: string }) {
  const tone = ['SETTLED', 'RECONCILED', 'APPROVED', 'ALLOW'].includes(status) ? 'positive' : ['FAILED', 'CANCELLED', 'DENY'].includes(status) ? 'negative' : ['REQUIRES_REVIEW', 'COMPLIANCE_PENDING', 'REVIEW'].includes(status) ? 'warning' : 'neutral';
  return <span className={`status-badge ${tone}`}><i />{humanize(status)}</span>;
}

export function humanize(value: string) { return value.toLowerCase().replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase()); }
