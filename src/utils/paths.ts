const base = import.meta.env.BASE_URL;

export function asset(path: string): string {
  const clean = path.startsWith('/') ? path : '/' + path;
  return base.endsWith('/') ? base.slice(0, -1) + clean : base + clean;
}
