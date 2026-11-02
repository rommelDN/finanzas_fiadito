const TOKEN_KEY = 'fiadito.token';

export const tokenGuardado = () => localStorage.getItem(TOKEN_KEY);
export const guardarToken = (t: string | null) => (t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY));

/** Error de la API con los mensajes de validación del backend. */
export class ApiError extends Error {
  constructor(public status: number, public mensajes: string[]) {
    super(mensajes.join(' · '));
  }
}

/** Se dispara cuando el servidor rechaza la sesión (token vencido o inválido). */
export const SESION_EXPIRADA = 'fiadito:sesion-expirada';

async function pedir<T>(metodo: string, ruta: string, cuerpo?: unknown): Promise<T> {
  const headers: Record<string, string> = {};
  const token = tokenGuardado();
  if (token) headers.Authorization = `Bearer ${token}`;
  let body: BodyInit | undefined;
  if (cuerpo instanceof FormData) body = cuerpo;
  else if (cuerpo !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(cuerpo);
  }
  let res: Response;
  try {
    res = await fetch(`/api${ruta}`, { method: metodo, headers, body });
  } catch {
    throw new ApiError(0, ['No se pudo conectar con el servidor']);
  }
  if (res.status === 204) return undefined as T;
  const datos = await res.json().catch(() => null);
  if (!res.ok) {
    if (res.status === 401 && token && !ruta.startsWith('/auth/login')) window.dispatchEvent(new Event(SESION_EXPIRADA));
    const m = datos?.message;
    throw new ApiError(res.status, Array.isArray(m) ? m : [m ?? `Error ${res.status}`]);
  }
  return datos as T;
}

export const api = {
  get: <T,>(ruta: string) => pedir<T>('GET', ruta),
  post: <T,>(ruta: string, cuerpo?: unknown) => pedir<T>('POST', ruta, cuerpo),
  put: <T,>(ruta: string, cuerpo?: unknown) => pedir<T>('PUT', ruta, cuerpo),
  patch: <T,>(ruta: string, cuerpo?: unknown) => pedir<T>('PATCH', ruta, cuerpo),
  del: <T,>(ruta: string) => pedir<T>('DELETE', ruta),
};

/** Arma "?a=1&b=2" omitiendo valores vacíos. */
export const qs = (p: Record<string, string | undefined>) => {
  const s = new URLSearchParams(Object.entries(p).filter(([, v]) => v) as [string, string][]).toString();
  return s ? `?${s}` : '';
};
