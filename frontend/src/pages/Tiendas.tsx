import { FormEvent, useState } from 'react';
import { ApiError, api } from '../api';
import { Campo, Cargando, Encabezado, Errores, Insignia, Tabla, Vacio, useCarga } from '../ui';

interface Tienda {
  id: string; ruc: string; razonSocial: string; nombreComercial: string; giroNegocio: string; direccion: string; estado: string;
  usuarios: { id: string; username: string; nombre: string; estado: string }[];
}

const VACIO = { ruc: '', razonSocial: '', nombreComercial: '', giroNegocio: '', direccion: '', username: '', password: '', nombre: '' };

export default function Tiendas() {
  const { datos, error, cargando, recargar } = useCarga(() => api.get<Tienda[]>('/tiendas'), []);
  const [abierto, setAbierto] = useState(false);
  const [f, setF] = useState(VACIO);
  const [errForm, setErrForm] = useState<string | null>(null);
  const set = (k: keyof typeof VACIO, v: string) => setF((x) => ({ ...x, [k]: v }));

  async function crear(e: FormEvent) {
    e.preventDefault();
    setErrForm(null);
    try {
      await api.post('/tiendas', {
        ruc: f.ruc.trim(), razonSocial: f.razonSocial.trim(), nombreComercial: f.nombreComercial.trim(), giroNegocio: f.giroNegocio.trim(), direccion: f.direccion.trim(),
        admin: { username: f.username.trim(), password: f.password, nombre: f.nombre.trim() },
      });
      setAbierto(false);
      setF(VACIO);
      recargar();
    } catch (err) {
      setErrForm(err instanceof ApiError ? err.mensajes.join(' · ') : 'No se pudo crear');
    }
  }

  async function cambiar(t: Tienda) {
    if (t.estado === 'ACTIVA') {
      if (!confirm(`¿Dar de baja "${t.nombreComercial}"? Se conserva su historial pero no podrá registrar compras nuevas.`)) return;
      await api.del(`/tiendas/${t.id}`);
    } else {
      await api.patch(`/tiendas/${t.id}`, { estado: 'ACTIVA' });
    }
    recargar();
  }

  return (
    <>
      <Encabezado ruta="Tiendas" titulo="Tiendas" sub="Negocios que usan Fiadito. Cada una ve únicamente sus propios datos.">
        <button className="btn pri" onClick={() => setAbierto((x) => !x)}>+ Nueva tienda</button>
      </Encabezado>

      {abierto && (
        <form className="card mb20" onSubmit={crear}>
          <h2>Alta de tienda</h2>
          <div className="frow">
            <Campo label="RUC" ayuda="RUC de 11 dígitos. Es único: no puede haber dos tiendas con el mismo RUC."><input value={f.ruc} onChange={(e) => set('ruc', e.target.value)} pattern="\d{11}" maxLength={11} required /></Campo>
            <Campo label="Razón social" ayuda="Nombre legal de la empresa."><input value={f.razonSocial} onChange={(e) => set('razonSocial', e.target.value)} required maxLength={150} /></Campo>
            <Campo label="Nombre comercial" ayuda="Nombre con el que se conoce el negocio."><input value={f.nombreComercial} onChange={(e) => set('nombreComercial', e.target.value)} required maxLength={100} /></Campo>
          </div>
          <div className="frow">
            <Campo label="Giro del negocio" ayuda="Bodega, panadería, pollería, peluquería, spa…"><input value={f.giroNegocio} onChange={(e) => set('giroNegocio', e.target.value)} required maxLength={60} /></Campo>
            <Campo label="Dirección" ayuda="Dirección del local."><input value={f.direccion} onChange={(e) => set('direccion', e.target.value)} required maxLength={200} /></Campo>
          </div>
          <div className="b" style={{ margin: '4px 0 8px' }}>Administrador del negocio (credenciales de acceso)</div>
          <div className="frow">
            <Campo label="Nombre" ayuda="Nombre de la persona que administrará la tienda."><input value={f.nombre} onChange={(e) => set('nombre', e.target.value)} required maxLength={150} /></Campo>
            <Campo label="Usuario" ayuda="3 a 40 caracteres: letras, números, punto, guion o guion bajo. Debe ser único en toda la plataforma."><input value={f.username} onChange={(e) => set('username', e.target.value)} pattern="[A-Za-z0-9._-]{3,40}" required autoComplete="off" /></Campo>
            <Campo label="Contraseña inicial" ayuda="Mínimo 8 caracteres. Se guarda cifrada; el administrador podrá usarla para su primer ingreso."><input type="password" value={f.password} onChange={(e) => set('password', e.target.value)} minLength={8} required autoComplete="new-password" /></Campo>
          </div>
          <Errores error={errForm} />
          <div className="mt16" style={{ display: 'flex', gap: 10 }}><button className="btn pri">Crear tienda</button><button type="button" className="btn" onClick={() => setAbierto(false)}>Cancelar</button></div>
        </form>
      )}

      <div className="card">
        {cargando && !datos ? <Cargando /> : error ? <Errores error={error} /> : !datos?.length ? <Vacio texto="No hay tiendas." /> : (
          <Tabla>
            <thead><tr><th>Tienda</th><th>RUC</th><th>Giro</th><th>Administrador</th><th>Estado</th><th /></tr></thead>
            <tbody>
              {datos.map((t) => (
                <tr key={t.id}>
                  <td><div className="b">{t.nombreComercial}</div><div className="m sm">{t.razonSocial}</div></td>
                  <td>{t.ruc}</td><td>{t.giroNegocio}</td>
                  <td>{t.usuarios.map((u) => u.username).join(', ') || '—'}</td>
                  <td><Insignia estado={t.estado} /></td>
                  <td className="r"><button className={`btn sm ${t.estado === 'ACTIVA' ? 'danger' : ''}`} onClick={() => cambiar(t)}>{t.estado === 'ACTIVA' ? 'Dar de baja' : 'Reactivar'}</button></td>
                </tr>
              ))}
            </tbody>
          </Tabla>
        )}
      </div>
    </>
  );
}
