'use client';

interface StatCardProps {
  label: string;
  value: string;
  color?: string;
}

export function StatCard({ label, value, color }: StatCardProps) {
  return (
    <div className="rounded-xl bg-card px-4 py-3">
      <div className="text-xs text-muted">{label}</div>
      <div className="mt-1 text-lg font-bold tabular-nums" style={color ? { color } : undefined}>
        {value}
      </div>
    </div>
  );
}
