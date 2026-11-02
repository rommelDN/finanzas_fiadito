import { DependencyList, ReactNode, useCallback, useEffect, useState } from 'react';
import { ApiError } from './api';

// ------------------------------------------------------------------ formato
export const money = (x: string | number | null | undefined) =>
  `S/ ${Number(x ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** "2026-10-26T00:00:00.000Z" → "26/10/2026" (las fechas de la BD son de calendario, sin huso). */
export const fd = (s?: string | null) => (s ? `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}` : '—');
export const fdh = (s?: string | null) => (s ? `${fd(s)} ${s.slice(11, 16)}` : '—');
export const pct = (x: string | number | null | undefined, d = 4) => (x === null || x === undefined ? '—' : `${Number(x).toFixed(d)} %`);
export const hoyISO = () => new Date(Date.now() - 5 * 3_600_000).toISOString().slice(0, 10);
export const ahoraLocal = () => new Date(Date.now() - 5 * 3_600_000).toISOString().slice(0, 16);

export const PERIODOS = ['DIARIA', 'QUINCENAL', 'MENSUAL', 'BIMESTRAL', 'TRIMESTRAL', 'CUATRIMESTRAL', 'SEMESTRAL', 'ANUAL'];
export const MEDIOS = ['EFECTIVO', 'YAPE', 'PLIN', 'TRANSFERENCIA'];
export const UNIDADES = ['UND', 'KG', 'LT', 'PAQ', 'SERVICIO'];

// ------------------------------------------------------------------ carga de datos
export function useCarga<T>(fn: () => Promise<T>, deps: DependencyList) {
  const [datos, setDatos] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const recargar = useCallback(() => {
    setCargando(true);
    return fn()
      .then((d) => {
        setDatos(d);
        setError(null);
      })
      .catch((e) => setError(e instanceof ApiError ? e.message : String(e)))
      .finally(() => setCargando(false));
  }, deps);
  useEffect(() => {
    recargar();
  }, [recargar]);
  return { datos, error, cargando, recargar };
}

// ------------------------------------------------------------------ componentes
export function Encabezado({ ruta, titulo, sub, children }: { ruta?: string; titulo: string; sub?: string; children?: ReactNode }) {
  return (
    <>
      {ruta && <div className="crumb">{ruta}</div>}
      <div className="hdr">
        <div className="t">
          <h1>{titulo}</h1>
          {sub && <div className="sub">{sub}</div>}
        </div>
        {children}
      </div>
    </>
  );
}

/** Campo de formulario con ayuda en línea (tooltip). `ayuda` es obligatoria: todo campo la lleva. */
export function Campo({ label, ayuda, children, ancho }: { label: string; ayuda: string; children: ReactNode; ancho?: number }) {
  return (
    <div className="f" style={ancho ? { flex: `0 0 ${ancho}px` } : undefined}>
      <label>
        {label}
        <span className="tip" data-h={ayuda} title={ayuda} tabIndex={0} aria-label={`Ayuda: ${ayuda}`}>
          ?
        </span>
      </label>
      {children}
    </div>
  );
}

export function Tip({ texto }: { texto: string }) {
  return (
    <span className="tip" data-h={texto} title={texto} tabIndex={0}>
      ?
    </span>
  );
}

export function Insignia({ estado }: { estado: string }) {
  const clase: Record<string, string> = {
    ACTIVO: 'ok', ACTIVA: 'ok', PAGADO: 'ok', PAGADA: 'ok', CANCELADA: 'gray', VIGENTE: 'pri-b',
    INACTIVO: 'gray', INACTIVA: 'gray', PENDIENTE: 'amb', MORA: 'red', CUOTA: 'pri-b',
  };
  return <span className={`badge ${clase[estado] ?? 'gray'}`}>{estado}</span>;
}

export function Errores({ error }: { error: string | string[] | null }) {
  if (!error || (Array.isArray(error) && !error.length)) return null;
  const lista = Array.isArray(error) ? error : [error];
  return (
    <div className="note err" role="alert">
      {lista.length === 1 ? lista[0] : <ul>{lista.map((e, i) => <li key={i}>{e}</li>)}</ul>}
    </div>
  );
}

export function Cargando() {
  return <div className="loading">Cargando…</div>;
}

export function Vacio({ texto }: { texto: string }) {
  return <div className="empty">{texto}</div>;
}

export function Kpi({ titulo, valor, sub, color }: { titulo: string; valor: string; sub?: string; color?: string }) {
  return (
    <div className="card kpi">
      <div className="l">{titulo}</div>
      <div className="v" style={color ? { color } : undefined}>{valor}</div>
      {sub && <div className="s">{sub}</div>}
    </div>
  );
}

export function Kv({ k, v, grande }: { k: string; v: ReactNode; grande?: boolean }) {
  return (
    <div className={`kv${grande ? ' big' : ''}`}>
      <span>{k}</span>
      <span>{v}</span>
    </div>
  );
}

/** Barra de uso del crédito: ámbar desde 75 %, roja desde 95 %. */
export function BarraUso({ usado, limite }: { usado: number; limite: number }) {
  const p = limite > 0 ? Math.min(100, Math.max(0, (usado / limite) * 100)) : 0;
  return (
    <div className={`bar${p >= 95 ? ' bad' : p >= 75 ? ' warn' : ''}`} title={`${p.toFixed(0)} % del límite`}>
      <i style={{ width: `${p}%` }} />
    </div>
  );
}

export function Tabla({ children }: { children: ReactNode }) {
  return (
    <div className="table-wrap">
      <table>{children}</table>
    </div>
  );
}
