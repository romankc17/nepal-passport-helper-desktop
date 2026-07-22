export function formatRelativeTime(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return 'never';
  const time = new Date(iso).getTime();
  if (Number.isNaN(time)) return 'never';
  const diffSeconds = Math.round((now - time) / 1000);
  if (diffSeconds < 0) return formatCountdown(-diffSeconds * 1000) + ' from now';
  if (diffSeconds < 60) return 'just now';
  const minutes = Math.floor(diffSeconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.floor(hours / 24);
  return `${days} d ago`;
}

export function formatCountdown(ms: number): string {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60);
    return `${hours} h ${minutes % 60} min`;
  }
  return minutes > 0 ? `${minutes} min ${seconds}s` : `${seconds}s`;
}

export function formatTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatInterval(seconds: number): string {
  if (seconds < 60) return `every ${seconds}s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `every ${minutes} min`;
  return `every ${Math.round((minutes / 60) * 10) / 10} h`;
}

export function truncateMiddle(value: string | null | undefined, keep = 8): string {
  if (!value) return '—';
  if (value.length <= keep * 2 + 3) return value;
  return `${value.slice(0, keep)}…${value.slice(-keep)}`;
}

// Province/district names arrive as "Kathmandu/काठमाडौं" — show the Latin part.
export function latinName(name: string): string {
  return name.split('/')[0]?.trim() || name;
}

// Country label worth showing next to an office name — "Nepal" is the default
// and would just be noise, so only foreign-mission countries surface.
export function foreignCountry(name: string | null | undefined): string {
  return name && name !== 'Nepal' ? name : '';
}
