/** Fecha de calendario sin zona horaria (evita errores de huso horario). */
export interface Fecha {
  y: number;
  m: number; // 1..12
  d: number; // 1..31
}

export const ultimoDia = (y: number, m: number): number => new Date(Date.UTC(y, m, 0)).getUTCDate();

/** Crea una fecha normalizando el mes y recortando el día al último día del mes. */
export const mk = (y: number, m: number, d: number): Fecha => {
  while (m > 12) {
    m -= 12;
    y++;
  }
  while (m < 1) {
    m += 12;
    y--;
  }
  return { y, m, d: Math.min(d, ultimoDia(y, m)) };
};

/** Suma k meses conservando el día pactado `dia` (31 → 28/02, luego 31/03). */
export const sumarMeses = (f: Fecha, k: number, dia: number = f.d): Fecha => mk(f.y, f.m + k, dia);

/** Días 30E/360: d = 360(A2−A1) + 30(M2−M1) + (D2−D1), con D = min(día, 30). */
export const dias360 = (a: Fecha, b: Fecha): number =>
  360 * (b.y - a.y) + 30 * (b.m - a.m) + (Math.min(b.d, 30) - Math.min(a.d, 30));

export const cmpFecha = (a: Fecha, b: Fecha): number => a.y - b.y || a.m - b.m || a.d - b.d;

const p2 = (n: number) => String(n).padStart(2, '0');
export const fechaISO = (f: Fecha): string => `${f.y}-${p2(f.m)}-${p2(f.d)}`;
export const fechaDMY = (f: Fecha): string => `${p2(f.d)}/${p2(f.m)}/${f.y}`;

/** Acepta "YYYY-MM-DD" (o ISO con hora) y devuelve Fecha. */
export const parseISO = (s: string): Fecha => {
  const [y, m, d] = s.slice(0, 10).split('-').map(Number);
  if (!y || !m || !d) throw new Error(`Fecha inválida: ${s}`);
  return { y, m, d };
};

/** Convierte "HH:mm" o "HH:mm:ss" a minutos desde medianoche. */
export const minutos = (hhmm: string): number => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + (m || 0);
};
