import { FormEvent, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ApiError, api, qs } from '../api';
import { Campo, Cargando, Encabezado, Errores, Insignia, Kv, Tabla, Vacio, fd, money, pct, useCarga } from '../ui';

interface Item { id: string; tipo: 'CUOTA' | 'MORA'; fecha: string; descripcion: string; capital: string; dias: number | null; tasaPeriodo: string | null; interes: string; subtotal: string }
interface CuotaEC { id: string; numero: number; estado: 'PENDIENTE' | 'PAGADA'; compra: { id: string; nCuotas: number }; pago: null | { montoTotal: string } }
interface Estado {
  id: string; clienteId: string; fechaCorte: string; fechaPago: string; totalCapital: string; totalInteresesCuotas: string; total: string; estado: 'PENDIENTE' | 'PAGADO';
  cliente: { id: string; dni: string; nombres: string; apellidos: string };
  items?: Item[]; cuotas?: CuotaEC[];
  moraHoy?: { total: string; cuotas: { cuotaId: string; compraId: string; numero: number; dias: number; mora: string }[] };
}
interface ClienteMin { id: string; nombres: string; apellidos: string; dni: string }

function Documento({ id, onCerrar }: { id: string; onCerrar: () => void }) {
  const { datos: e, error, cargando } = useCarga(() => api.get<Estado>(`/estados-cuenta/${id}`), [id]);
  if (cargando) return <Cargando />;
  if (error || !e) return <Errores error={error} />;
  const items = e.items ?? [];
  const cuotas = items.filter((i) => i.tipo === 'CUOTA');
  const mora = items.filter((i) => i.tipo === 'MORA');
  const pendientes = (e.cuotas ?? []).filter((c) => c.estado === 'PENDIENTE');
  const moraPagada = mora.reduce((s, i) => s + Number(i.interes), 0);
  const moraHoy = Number(e.moraHoy?.total ?? 0);
  const totalFinal = Number(e.total) + moraPagada + moraHoy;

  return (
    <div className="mb20">
      <div className="tools noprint">
        <button className="btn" onClick={onCerrar}>Cerrar</button>
        <button className="btn pri" onClick={() => window.print()}>Imprimir / guardar PDF</button>
        {pendientes.length > 0 && <Link className="btn pri" to={`/cronograma?compra=${pendientes[0].compra.id}`}>Cobrar en el cronograma</Link>}
      </div>
      <div className="doc">
        <div className="hdr">
          <div className="t">
            <h1>Estado de cuenta #{e.id}</h1>
            <div className="sub">{e.cliente.apellidos}, {e.cliente.nombres} · DNI {e.cliente.dni}</div>
          </div>
          <Insignia estado={e.estado} />
        </div>
        <div className="row">
          <div><Kv k="Fecha de corte" v={fd(e.fechaCorte)} /><Kv k="Fecha de pago" v={fd(e.fechaPago)} /></div>
          <div><Kv k="Capital de las cuotas" v={money(e.totalCapital)} /><Kv k="Intereses de las cuotas" v={money(e.totalInteresesCuotas)} /></div>
        </div>
        <Tabla>
          <thead><tr><th>Vence</th><th>Detalle</th><th className="r">Capital</th><th className="r">Interés</th><th className="r">Subtotal</th><th>Situación</th></tr></thead>
          <tbody>
            {cuotas.map((i) => {
              const c = (e.cuotas ?? []).find((x) => `Compra #${x.compra.id} - cuota ${x.numero}/${x.compra.nCuotas}` === i.descripcion);
              return (
                <tr key={i.id}>
                  <td>{fd(i.fecha)}</td><td>{i.descripcion}</td><td className="r">{money(i.capital)}</td><td className="r">{money(i.interes)}</td><td className="r">{money(i.subtotal)}</td>
                  <td>{c ? <Insignia estado={c.estado} /> : null}</td>
                </tr>
              );
            })}
            {mora.map((i) => (
              <tr key={i.id}>
                <td>{fd(i.fecha)}</td>
                <td><b>{i.descripcion}</b><div className="m sm">{i.dias} días · tasa del periodo {pct(Number(i.tasaPeriodo) * 100, 7)}</div></td>
                <td className="r">—</td><td className="r">{money(i.interes)}</td><td className="r">{money(i.subtotal)}</td><td><span className="badge ok">Cobrada</span></td>
              </tr>
            ))}
            {(e.moraHoy?.cuotas ?? []).map((m) => (
              <tr key={m.cuotaId}>
                <td>—</td>
                <td><b>Intereses por mora a hoy - compra #{m.compraId} cuota {m.numero}</b><div className="m sm">{m.dias} días de atraso · se confirma al pagar</div></td>
                <td className="r">—</td><td className="r">{money(m.mora)}</td><td className="r">{money(m.mora)}</td><td><span className="badge red">Mora</span></td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr><td colSpan={2}>TOTAL DEL ESTADO</td><td className="r">{money(e.totalCapital)}</td><td className="r">{money(Number(e.totalInteresesCuotas) + moraPagada + moraHoy)}</td><td className="r" style={{ color: 'var(--pri)', fontSize: 16 }}>{money(totalFinal)}</td><td /></tr>
          </tfoot>
        </Tabla>
        {e.estado === 'PAGADO'
          ? <div className="note good">Todas las cuotas de este estado de cuenta están pagadas.</div>
          : <div className="note info">Las cuotas se cobran una por una desde el Cronograma de pagos. La mora se suma al pagar; los intereses por mora de las cuotas vencidas aparecen como ítem separado.</div>}
      </div>
    </div>
  );
}

export default function EstadosCuenta() {
  const [params, setParams] = useSearchParams();
  const ver = params.get('ver');
  const [clienteId, setClienteId] = useState('');
  const [estado, setEstado] = useState('');
  const { datos, error, cargando, recargar } = useCarga(() => api.get<Estado[]>(`/estados-cuenta${qs({ clienteId, estado })}`), [clienteId, estado]);
  const clientes = useCarga(() => api.get<ClienteMin[]>('/clientes'), []);

  const [gen, setGen] = useState(false);
  const [gCliente, setGCliente] = useState('');
  const [gFecha, setGFecha] = useState('');
  const [errGen, setErrGen] = useState<string | null>(null);

  async function generar(e: FormEvent) {
    e.preventDefault();
    setErrGen(null);
    try {
      const r = await api.post<Estado>('/estados-cuenta/generar', { clienteId: gCliente, fechaCorte: gFecha });
      setGen(false);
      await recargar();
      setParams({ ver: r.id });
    } catch (err) {
      setErrGen(err instanceof ApiError ? err.mensajes.join(' · ') : 'No se pudo generar');
    }
  }

  return (
    <>
      <Encabezado ruta="Estado de cuenta" titulo="Estados de cuenta" sub="Se generan en cada fecha de corte con las cuotas que vencen en el ciclo.">
        <button className="btn pri" onClick={() => setGen((x) => !x)}>Generar estado de cuenta</button>
      </Encabezado>

      {gen && (
        <form className="card mb20" onSubmit={generar}>
          <h2>Generar estado de cuenta</h2>
          <div className="sub mb20">La tarea diaria lo hace sola cada madrugada; aquí puedes generarlo a mano para una fecha de corte.</div>
          <div className="frow">
            <Campo label="Cliente" ayuda="Cliente para el que se genera el estado.">
              <select value={gCliente} onChange={(e) => setGCliente(e.target.value)} required>
                <option value="">Selecciona…</option>
                {clientes.datos?.map((c) => <option key={c.id} value={c.id}>{c.apellidos}, {c.nombres}</option>)}
              </select>
            </Campo>
            <Campo label="Fecha de corte" ayuda="Debe ser el día de corte del cliente (ej. día 20 de un mes). Se incluyen las cuotas que vencen hasta su fecha de pago.">
              <input type="date" value={gFecha} onChange={(e) => setGFecha(e.target.value)} required />
            </Campo>
          </div>
          <Errores error={errGen} />
          <div className="mt16" style={{ display: 'flex', gap: 10 }}><button className="btn pri">Generar</button><button type="button" className="btn" onClick={() => setGen(false)}>Cancelar</button></div>
        </form>
      )}

      {ver && <Documento id={ver} onCerrar={() => setParams({})} />}

      <div className="card noprint">
        <div className="tools">
          <select value={clienteId} onChange={(e) => setClienteId(e.target.value)}>
            <option value="">Todos los clientes</option>
            {clientes.datos?.map((c) => <option key={c.id} value={c.id}>{c.apellidos}, {c.nombres}</option>)}
          </select>
          <select value={estado} onChange={(e) => setEstado(e.target.value)}><option value="">Todos los estados</option><option>PENDIENTE</option><option>PAGADO</option></select>
        </div>
        {cargando && !datos ? <Cargando /> : error ? <Errores error={error} /> : !datos?.length ? <Vacio texto="No hay estados de cuenta." /> : (
          <Tabla>
            <thead><tr><th>N°</th><th>Cliente</th><th>Corte</th><th>Vence</th><th className="r">Capital</th><th className="r">Intereses</th><th className="r">Total</th><th>Estado</th><th /></tr></thead>
            <tbody>
              {datos.map((s) => (
                <tr key={s.id} className="click" onClick={() => setParams({ ver: s.id })}>
                  <td>#{s.id}</td><td className="b">{s.cliente.apellidos}, {s.cliente.nombres}</td>
                  <td>{fd(s.fechaCorte)}</td><td>{fd(s.fechaPago)}</td>
                  <td className="r">{money(s.totalCapital)}</td><td className="r">{money(s.totalInteresesCuotas)}</td><td className="r b">{money(s.total)}</td>
                  <td><Insignia estado={s.estado} /></td><td className="r"><button className="btn sm">Ver</button></td>
                </tr>
              ))}
            </tbody>
          </Tabla>
        )}
      </div>
    </>
  );
}
