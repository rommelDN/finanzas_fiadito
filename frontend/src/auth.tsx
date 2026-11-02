import { createContext, ReactNode, useCallback, useContext, useEffect, useState } from 'react';
import { api, guardarToken, SESION_EXPIRADA, tokenGuardado } from './api';

export type Rol = 'ADMIN_SISTEMA' | 'ADMIN_NEGOCIO';

export interface Usuario {
  id: string;
  username: string;
  nombre: string;
  rol: Rol;
  tiendaId: string | null;
}

interface Ctx {
  usuario: Usuario | null;
  cargando: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthCtx = createContext<Ctx>(null as unknown as Ctx);
export const useAuth = () => useContext(AuthCtx);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [usuario, setUsuario] = useState<Usuario | null>(null);
  const [cargando, setCargando] = useState(!!tokenGuardado());

  useEffect(() => {
    if (!tokenGuardado()) return;
    api
      .get<Usuario>('/auth/me')
      .then(setUsuario)
      .catch(() => guardarToken(null))
      .finally(() => setCargando(false));
  }, []);

  useEffect(() => {
    const salir = () => {
      guardarToken(null);
      setUsuario(null);
    };
    window.addEventListener(SESION_EXPIRADA, salir);
    return () => window.removeEventListener(SESION_EXPIRADA, salir);
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    const r = await api.post<{ token: string }>('/auth/login', { username, password });
    guardarToken(r.token);
    setUsuario(await api.get<Usuario>('/auth/me'));
  }, []);

  const logout = useCallback(async () => {
    await api.post('/auth/logout').catch(() => undefined);
    guardarToken(null);
    setUsuario(null);
  }, []);

  return <AuthCtx.Provider value={{ usuario, cargando, login, logout }}>{children}</AuthCtx.Provider>;
}
