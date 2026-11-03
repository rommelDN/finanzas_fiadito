import { FormEvent, useEffect, useState } from 'react';
import { ApiError, api, qs } from '../api';
import { Campo, Cargando, Encabezado, Errores, Insignia, Kv, PERIODOS, Tabla, Vacio, money, pct, useCarga } from '../ui';

interface Calculos { p: number; pMora: number; tem: string; temPct: string; teaInteresPct: string; teaMoraPct: string }
interface Cliente {
  id: string; dni: string; nombres: string; apellidos: string; direccion: string | null; telefono: string | null;
  tasaInteres: string; periodoTasa: string; tasaMora: string; periodoTasaMora: string; limiteCredito: string; maxCuotas: number;
  aceptaPrivacidad: boolean; estado: string; calculos: Calculos;
}
interface Prevision { ok: boolean; errores: string[]; calculos: Calculos; topes: { topeInteresTEA: string; topeMoraTEA: string } }
interface Resumen { clientes: { id: string; deudaPendiente: string }[] }

const VACIO = {
  dni: '', nombres: '', apellidos: '', direccion: '', telefono: '',
  tasaInteres: '', periodoTasa: 'MENSUAL', tasaMora: '', periodoTasaMora: 'ANUAL',
  limiteCredito: '', maxCuotas: '8',
  aceptaPrivacidad: false, estado: 'ACTIVO',
};
type Form = typeof VACIO;

export default function Clientes() {
  const [q, setQ] = useState('');
  const [estado, setEstado] = useState('');
  const { datos, error, cargando, recargar } = useCarga(() => api.get<Cliente[]>(`/clientes${qs({ q, estado })}`), [q, estado]);
  const { datos: resumen } = useCarga(() => api.get<Resumen>('/resumen'), []);
  const deuda = new Map(resumen?.clientes.map((c) => [c.id, c.deudaPendiente]));

  const [editando, setEditando] = useState<string | 'nuevo' | null>(null);
  const [f, setF] = useState<Form>(VACIO);
  const [errForm, setErrForm] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [prev, setPrev] = useState<Prevision | null>(null);
  const [errPrev, setErrPrev] = useState<string | null>(null);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((x) => ({ ...x, [k]: v }));

  // Panel "Lo que calcula la app": se recalcula al cambiar las tasas.
  useEffect(() => {
    if (!editando || f.tasaInteres === '' || f.tasaMora === '') { setPrev(null); setErrPrev(null); return; }
    const t = setTimeout(() => {
      api.post<Prevision>('/clientes/calcular', {
        tasaInteres: Number(f.tasaInteres), periodoTasa: f.periodoTasa, tasaMora: Number(f.tasaMora), periodoTasaMora: f.periodoTasaMora,
      }).then((r) => { setPrev(r); setErrPrev(null); }).catch((e) => { setPrev(null); setErrPrev(e instanceof ApiError ? e.message : 'No se pudo calcular'); });
    }, 350);
    return () => clearTimeout(t);
  }, [editando, f.tasaInteres, f.periodoTasa, f.tasaMora, f.periodoTasaMora]);

  function abrir(c?: Cliente) {
    setErrForm(null);
    setEditando(c ? c.id : 'nuevo');
    setF(c ? {
      dni: c.dni, nombres: c.nombres, apellidos: c.apellidos, direccion: c.direccion ?? '', telefono: c.telefono ?? '',
      tasaInteres: String(Number(c.tasaInteres)), periodoTasa: c.periodoTasa, tasaMora: String(Number(c.tasaMora)), periodoTasaMora: c.periodoTasaMora,
      limiteCredito: String(Number(c.limiteCredito)), maxCuotas: String(c.maxCuotas),
      aceptaPrivacidad: c.aceptaPrivacidad, estado: c.estado,
    } : VACIO);
  }

  async function guardar(e: FormEvent) {
    e.preventDefault();
    setErrForm(null);
    setGuardando(true);
    const cuerpo: Record<string, unknown> = {
      nombres: f.nombres.trim(), apellidos: f.apellidos.trim(), direccion: f.direccion.trim() || undefined, telefono: f.telefono.trim() || undefined,
      tasaInteres: Number(f.tasaInteres), periodoTasa: f.periodoTasa, tasaMora: Number(f.tasaMora), periodoTasaMora: f.periodoTasaMora,
      limiteCredito: Number(f.limiteCredito), maxCuotas: Number(f.maxCuotas),
    };
    try {
      if (editando === 'nuevo') {
        await api.post('/clientes', {
          ...cuerpo, dni: f.dni.trim(), aceptaPrivacidad: f.aceptaPrivacidad,
        });
      } else {
        await api.patch(`/clientes/${editando}`, { ...cuerpo, estado: f.estado });
      }
      setEditando(null);
      await recargar();
    } catch (err) {
      setErrForm(err instanceof ApiError ? err.mensajes.join(' · ') : 'No se pudo guardar');
    } finally {
      setGuardando(false);
    }
  }

  async function cambiarEstado(c: Cliente) {
    try {
      if (c.estado === 'ACTIVO') {
        if (!confirm(`¿Dar de baja a ${c.nombres} ${c.apellidos}? Se conserva su historial.`)) return;
        await api.del(`/clientes/${c.id}`);
      } else {
        await api.patch(`/clientes/${c.id}`, { estado: 'ACTIVO' });
      }
      recargar();
    } catch (err) {
      alert(err instanceof ApiError ? err.message : 'No se pudo cambiar el estado');
    }
  }

  const nuevo = editando === 'nuevo';
  return (
    <>
      <Encabezado ruta="Clientes" titulo="Clientes" sub="Vecinos a quienes les fías, con su tasa pactada, límite y plazo de pago.">
        <button className="btn pri" onClick={() => abrir()}>+ Nuevo cliente</button>
      </Encabezado>

      {editando && (
        <form className="row" onSubmit={guardar}>
          <div className="card" style={{ flex: 2 }}>
            <h2>{nuevo ? 'Nuevo cliente' : 'Editar cliente'}</h2>
            <div className="frow">
              <Campo label="DNI" ayuda="Documento de 8 dígitos. Es único por tienda y no se puede cambiar después.">
                <input value={f.dni} onChange={(e) => set('dni', e.target.value)} pattern="\d{8}" maxLength={8} required disabled={!nuevo} />
              </Campo>
              <Campo label="Nombres" ayuda="Nombres del cliente."><input value={f.nombres} onChange={(e) => set('nombres', e.target.value)} required maxLength={80} /></Campo>
              <Campo label="Apellidos" ayuda="Apellidos del cliente."><input value={f.apellidos} onChange={(e) => set('apellidos', e.target.value)} required maxLength={80} /></Campo>
            </div>
            <div className="frow">
              <Campo label="Dirección" ayuda="Dónde vive o recibe sus pedidos (opcional)."><input value={f.direccion} onChange={(e) => set('direccion', e.target.value)} maxLength={150} /></Campo>
              <Campo label="Teléfono" ayuda="Celular o teléfono de contacto (opcional)."><input value={f.telefono} onChange={(e) => set('telefono', e.target.value)} maxLength={15} /></Campo>
            </div>
            <div className="frow">
              <Campo label="Tasa efectiva de interés (%)" ayuda="Tasa efectiva pactada para el crédito, en porcentaje (ej. 3 para 3 %). El periodo se elige al lado.">
                <input type="number" step="0.0000001" min="0.0000001" value={f.tasaInteres} onChange={(e) => set('tasaInteres', e.target.value)} required />
              </Campo>
              <Campo label="Periodo de la tasa" ayuda="Cada cuánto se cobra esa tasa: mensual, bimestral, anual… La app la convierte a mes (TEM) y a año (TEA).">
                <select value={f.periodoTasa} onChange={(e) => set('periodoTasa', e.target.value)}>{PERIODOS.map((p) => <option key={p}>{p}</option>)}</select>
              </Campo>
            </div>
            <div className="frow">
              <Campo label="Tasa efectiva moratoria (%)" ayuda="Tasa efectiva que se cobra por cada periodo de atraso en el pago. Se calcula solo sobre lo vencido.">
                <input type="number" step="0.0000001" min="0" value={f.tasaMora} onChange={(e) => set('tasaMora', e.target.value)} required />
              </Campo>
              <Campo label="Periodo de la tasa moratoria" ayuda="Periodo al que corresponde la tasa moratoria.">
                <select value={f.periodoTasaMora} onChange={(e) => set('periodoTasaMora', e.target.value)}>{PERIODOS.map((p) => <option key={p}>{p}</option>)}</select>
              </Campo>
            </div>
            <div className="frow">
              <Campo label="Límite de crédito (S/)" ayuda="Máximo que el cliente puede deber en capital, hasta S/ 250 (créditos pequeños). No se aceptan compras que lo excedan.">
                <input type="number" step="0.01" min="0.01" max="250" value={f.limiteCredito} onChange={(e) => set('limiteCredito', e.target.value)} required />
              </Campo>
              <Campo label="Máximo de cuotas" ayuda="Referencial: hoy todos los créditos se otorgan en exactamente 8 cuotas, sin importar este valor.">
                <input type="number" min="1" max="8" value={f.maxCuotas} onChange={(e) => set('maxCuotas', e.target.value)} required />
              </Campo>
            </div>
            {nuevo ? (
              <>
                <div className="f chk">
                  <input id="priv" type="checkbox" checked={f.aceptaPrivacidad} onChange={(e) => set('aceptaPrivacidad', e.target.checked)} required />
                  <label htmlFor="priv">El cliente acepta el tratamiento de sus datos personales (Ley 29733)</label>
                </div>
              </>
            ) : (
              <Campo label="Estado" ayuda="Un cliente INACTIVO no puede comprar al crédito. Para darlo de baja no debe tener cuotas pendientes.">
                <select value={f.estado} onChange={(e) => set('estado', e.target.value)}><option>ACTIVO</option><option>INACTIVO</option></select>
              </Campo>
            )}
            <Errores error={errForm} />
            <div className="mt16" style={{ display: 'flex', gap: 10 }}>
              <button className="btn pri" disabled={guardando}>{guardando ? 'Guardando…' : 'Guardar'}</button>
              <button type="button" className="btn" onClick={() => setEditando(null)}>Cancelar</button>
            </div>
          </div>

          <div className="card side340" style={{ alignSelf: 'flex-start' }}>
            <h2>Lo que calcula la app</h2>
            {prev ? (
              <>
                <Kv k="Días del periodo (p)" v={prev.calculos.p} />
                <Kv k="Días del periodo de mora" v={prev.calculos.pMora} />
                <Kv k="TEM (tasa efectiva mensual)" v={pct(prev.calculos.temPct, 7)} />
                <Kv k="TEA de interés" v={pct(prev.calculos.teaInteresPct, 7)} grande />
                <Kv k="TEA de mora" v={pct(prev.calculos.teaMoraPct, 7)} />
                <div className={`note ${prev.ok ? 'good' : 'err'}`}>
                  {prev.ok ? (
                    <>Dentro de los topes BCRP vigentes (interés ≤ {pct(prev.topes.topeInteresTEA, 2)}, mora ≤ {pct(prev.topes.topeMoraTEA, 2)} TEA).</>
                  ) : (
                    <ul>{prev.errores.map((e, i) => <li key={i}>{e}</li>)}</ul>
                  )}
                </div>
              </>
            ) : errPrev ? <Errores error={errPrev} /> : <div className="m">Ingresa las tasas para ver la TEM, la TEA y la validación contra los topes del BCRP.</div>}
          </div>
        </form>
      )}

      <div className="card">
        <div className="tools">
          <input placeholder="Buscar por DNI o nombre…" value={q} onChange={(e) => setQ(e.target.value)} />
          <select value={estado} onChange={(e) => setEstado(e.target.value)}><option value="">Todos los estados</option><option>ACTIVO</option><option>INACTIVO</option></select>
        </div>
        {cargando && !datos ? <Cargando /> : error ? <Errores error={error} /> : !datos?.length ? <Vacio texto="No hay clientes." /> : (
          <Tabla>
            <thead><tr><th>Cliente</th><th>Tasa pactada</th><th className="r">TEA</th><th className="r">Límite</th><th className="r">Deuda</th><th>Estado</th><th /></tr></thead>
            <tbody>
              {datos.map((c) => (
                <tr key={c.id}>
                  <td><div className="b">{c.apellidos}, {c.nombres}</div><div className="m sm">DNI {c.dni}</div></td>
                  <td>{Number(c.tasaInteres)} % {c.periodoTasa.toLowerCase()}</td>
                  <td className="r">{pct(c.calculos.teaInteresPct, 2)}</td>
                  <td className="r">{money(c.limiteCredito)}</td>
                  <td className="r">{deuda.has(c.id) ? money(deuda.get(c.id)) : '—'}</td>
                  <td><Insignia estado={c.estado} /></td>
                  <td className="r">
                    <button className="btn sm" onClick={() => abrir(c)}>Editar</button>{' '}
                    <button className={`btn sm ${c.estado === 'ACTIVO' ? 'danger' : ''}`} onClick={() => cambiarEstado(c)}>{c.estado === 'ACTIVO' ? 'Dar de baja' : 'Reactivar'}</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </Tabla>
        )}
      </div>
    </>
  );
}
