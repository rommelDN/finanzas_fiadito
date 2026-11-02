import { FormEvent, useEffect, useState } from 'react';
import { ApiError, api } from '../api';
import { useAuth } from '../auth';
import { Campo, Cargando, Encabezado, Errores, Insignia, Kv, Tabla, fd, hoyISO, money, pct, useCarga } from '../ui';

interface Param { id: string; clave: string; valor: string; vigenteDesde: string; vigenteHasta: string | null; vigente: boolean }
interface Parametros { parametros: Param[]; limites: { limiteMaximoCredito: number; maxCuotas: number } }
interface Tienda { id: string; ruc: string; razonSocial: string; nombreComercial: string; giroNegocio: string; direccion: string; estado: string }

function DatosTienda() {
  const { datos: t, cargando, error, recargar } = useCarga(() => api.get<Tienda>('/tiendas/mi'), []);
  const [f, setF] = useState({ razonSocial: '', nombreComercial: '', giroNegocio: '', direccion: '' });
  const [msg, setMsg] = useState<{ ok: boolean; texto: string } | null>(null);
  useEffect(() => {
    if (t) setF({ razonSocial: t.razonSocial, nombreComercial: t.nombreComercial, giroNegocio: t.giroNegocio, direccion: t.direccion });
  }, [t]);

  async function guardar(e: FormEvent) {
    e.preventDefault();
    try {
      await api.patch('/tiendas/mi', f);
      setMsg({ ok: true, texto: 'Datos guardados.' });
      recargar();
    } catch (err) {
      setMsg({ ok: false, texto: err instanceof ApiError ? err.mensajes.join(' · ') : 'No se pudo guardar' });
    }
  }
  if (cargando) return <Cargando />;
  if (error || !t) return <Errores error={error} />;
  return (
    <form className="card" style={{ flex: 1 }} onSubmit={guardar}>
      <h2>Datos de la tienda</h2>
      <Campo label="RUC" ayuda="RUC de la tienda. Lo registró el administrador del sistema y no se puede cambiar aquí."><input value={t.ruc} disabled /></Campo>
      <Campo label="Razón social" ayuda="Nombre legal de la empresa."><input value={f.razonSocial} onChange={(e) => setF({ ...f, razonSocial: e.target.value })} required maxLength={150} /></Campo>
      <Campo label="Nombre comercial" ayuda="Nombre con el que te conocen tus clientes."><input value={f.nombreComercial} onChange={(e) => setF({ ...f, nombreComercial: e.target.value })} required maxLength={100} /></Campo>
      <Campo label="Giro del negocio" ayuda="Tipo de negocio: bodega, panadería, pollería, peluquería, spa…"><input value={f.giroNegocio} onChange={(e) => setF({ ...f, giroNegocio: e.target.value })} required maxLength={60} /></Campo>
      <Campo label="Dirección" ayuda="Dirección del local."><input value={f.direccion} onChange={(e) => setF({ ...f, direccion: e.target.value })} required maxLength={200} /></Campo>
      <Kv k="Estado" v={<Insignia estado={t.estado} />} />
      {msg && <div className={`note ${msg.ok ? 'good' : 'err'}`}>{msg.texto}</div>}
      <button className="btn pri mt16">Guardar</button>
    </form>
  );
}

function Reglas({ edita }: { edita: boolean }) {
  const { datos, cargando, error, recargar } = useCarga(() => api.get<Parametros>('/parametros'), []);
  const [interes, setInteres] = useState('');
  const [mora, setMora] = useState('');
  const [desde, setDesde] = useState(hoyISO());
  const [msg, setMsg] = useState<{ ok: boolean; texto: string } | null>(null);

  async function fijar(e: FormEvent) {
    e.preventDefault();
    try {
      await api.put('/parametros/topes', { topeInteresTEA: Number(interes), topeMoraTEA: Number(mora), vigenteDesde: desde });
      setMsg({ ok: true, texto: 'Topes registrados.' });
      recargar();
    } catch (err) {
      setMsg({ ok: false, texto: err instanceof ApiError ? err.mensajes.join(' · ') : 'No se pudo guardar' });
    }
  }
  if (cargando) return <Cargando />;
  if (error || !datos) return <Errores error={error} />;
  const topes = datos.parametros.filter((p) => p.clave.startsWith('tope'));
  const base = datos.parametros.filter((p) => !p.clave.startsWith('tope'));
  return (
    <>
      <div className="card" style={{ flex: 1 }}>
        <h2>Reglas de cálculo</h2>
        <div className="sub mb20">Convenciones fijas del Anexo A. Todo es en soles (S/).</div>
        {base.map((p) => <Kv key={p.id} k={p.clave} v={p.valor} />)}
        <div className="b mt16 mb20">Límites de los créditos</div>
        <Kv k="Crédito máximo por cliente" v={money(datos.limites.limiteMaximoCredito)} />
        <Kv k="Máximo de cuotas" v={datos.limites.maxCuotas} />
      </div>
      <div className="card" style={{ flex: 2 }}>
        <h2>Topes de tasas (TEA)</h2>
        <div className="sub mb20">Máxima TEA de interés y de mora que se puede pactar con un cliente. Se validan al registrarlo.</div>
        <Tabla>
          <thead><tr><th>Parámetro</th><th className="r">Valor (TEA)</th><th>Desde</th><th>Hasta</th><th /></tr></thead>
          <tbody>
            {topes.map((p) => (
              <tr key={p.id}><td>{p.clave === 'topeInteresTEA' ? 'Tope de interés' : 'Tope de mora'}</td><td className="r">{pct(p.valor, 2)}</td><td>{fd(p.vigenteDesde)}</td><td>{fd(p.vigenteHasta)}</td><td>{p.vigente ? <span className="badge ok">Vigente</span> : <span className="badge gray">Histórico</span>}</td></tr>
            ))}
          </tbody>
        </Tabla>
        {edita && (
          <form className="mt16" onSubmit={fijar}>
            <div className="b mb20">Registrar nueva vigencia</div>
            <div className="frow">
              <Campo label="Tope de interés (% TEA)" ayuda="Máxima TEA de interés que se podrá pactar con un cliente. Para créditos pequeños de tienda de barrio se usan valores moderados."><input type="number" step="0.01" min="0.01" value={interes} onChange={(e) => setInteres(e.target.value)} required /></Campo>
              <Campo label="Tope de mora (% TEA)" ayuda="Máxima TEA moratoria que se podrá pactar."><input type="number" step="0.01" min="0.01" value={mora} onChange={(e) => setMora(e.target.value)} required /></Campo>
              <Campo label="Vigente desde" ayuda="Fecha desde la que rige. La vigencia anterior se cierra el día previo."><input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} required /></Campo>
            </div>
            {msg && <div className={`note ${msg.ok ? 'good' : 'err'}`}>{msg.texto}</div>}
            <button className="btn pri mt16">Registrar</button>
          </form>
        )}
      </div>
    </>
  );
}

export default function Parametros() {
  const { usuario } = useAuth();
  const sistema = usuario?.rol === 'ADMIN_SISTEMA';
  return (
    <>
      <Encabezado ruta="Parámetros" titulo="Parámetros" sub={sistema ? 'Topes de tasas y reglas de cálculo.' : 'Datos de tu tienda y reglas de cálculo vigentes.'} />
      <div className="row">
        {!sistema && <DatosTienda />}
        <Reglas edita={sistema} />
      </div>
    </>
  );
}
