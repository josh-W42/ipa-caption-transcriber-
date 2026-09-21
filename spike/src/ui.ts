type Status = 'pass' | 'fail' | 'info' | 'running' | 'blocked';

const COLORS: Record<Status, string> = {
  pass: '#2a2',
  fail: '#c22',
  info: '#888',
  running: '#c80',
  blocked: '#68c',
};

export function report(probe: string, status: Status, detail: string): void {
  const root = document.querySelector<HTMLDivElement>('#results')!;
  const row = document.createElement('div');
  row.style.cssText = [
    `border-left:4px solid ${COLORS[status]}`,
    'padding:8px 14px',
    'margin:8px 0',
    'font-family:ui-monospace,SFMono-Regular,Menlo,monospace',
    'font-size:13px',
    'line-height:1.5',
    'white-space:pre-wrap',
    'background:#111',
    'color:#ddd',
  ].join(';');
  row.textContent = `[${status.toUpperCase()}] ${probe}\n${detail}`;
  root.appendChild(row);
  console.log(`[${status}] ${probe}`, detail);
}

/** Marks a long-running probe so the page is not silently blank during a 200MB download. */
export function progress(probe: string): (p: { status?: string; progress?: number; file?: string }) => void {
  const root = document.querySelector<HTMLDivElement>('#results')!;
  const row = document.createElement('div');
  row.style.cssText =
    `border-left:4px solid ${COLORS.running};padding:8px 14px;margin:8px 0;` +
    'font-family:ui-monospace,monospace;font-size:13px;background:#111;color:#ddd';
  row.textContent = `[RUNNING] ${probe}`;
  root.appendChild(row);

  return (p) => {
    if (p.progress != null && p.file) {
      row.textContent = `[RUNNING] ${probe}\n${p.file} — ${p.progress.toFixed(1)}%`;
    }
  };
}
