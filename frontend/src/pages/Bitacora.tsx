import { useState } from 'react';
import { api, qs } from '../api';
import { Cargando, Encabezado, Errores, Tabla, Vacio, fdh, useCarga } from '../ui';

interface Registro {
  id: string; fechaHora: string; accion: string; entidad: string; entidadId: string | null; ip: string | null;
  detalleJson: { ruta?: string } | null; usuario: { username: string; nombre: string; rol: string } | null;
}

export default function Bitacora() {
  const [entidad, setEntidad] = useState('');
  const { datos, error, cargando } = useCarga(() => api.get<Registro[]>(`/bitacora${qs({ limit: '200', entidad })}`), [entidad]);
  return (
    <>
      <Encabezado ruta="Bitácora" titulo="Bitácora de operaciones" sub="Registro de inicios de sesión y de toda operación que crea, modifica o elimina datos." />
      <div className="card">
        <div className="tools">
          <select value={entidad} onChange={(e) => setEntidad(e.target.value)}>
            <option value="">Todas las entidades</option>
            {['auth', 'tiendas', 'productos', 'clientes', 'compras', 'estados-cuenta', 'parametros'].map((x) => <option key={x}>{x}</option>)}
          </select>
        </div>
        {cargando && !datos ? <Cargando /> : error ? <Errores error={error} /> : !datos?.length ? <Vacio texto="Sin registros." /> : (
          <Tabla>
            <thead><tr><th>Fecha y hora</th><th>Usuario</th><th>Acción</th><th>Entidad</th><th>Detalle</th><th>IP</th></tr></thead>
            <tbody>
              {datos.map((b) => (
                <tr key={b.id}>
                  <td className="mono">{fdh(b.fechaHora)}</td><td>{b.usuario ? <><b>{b.usuario.username}</b> <span className="m sm">{b.usuario.rol}</span></> : '—'}</td>
                  <td><span className="badge pri-b">{b.accion}</span></td><td>{b.entidad}{b.entidadId ? ` #${b.entidadId}` : ''}</td>
                  <td className="m sm">{b.detalleJson?.ruta ?? ''}</td><td className="m sm">{b.ip}</td>
                </tr>
              ))}
            </tbody>
          </Tabla>
        )}
      </div>
    </>
  );
}
