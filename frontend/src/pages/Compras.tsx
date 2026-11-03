import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ApiError, api } from '../api';
import { Campo, Cargando, Encabezado, Errores, Insignia, Kv, Tabla, Vacio, ahoraLocal, fd, fdh, money, pct, useCarga, CUOTAS_FIJAS, PERIODOS_CUOTA, siglaTasa } from '../ui';

interface ClienteMin { id: string; dni: string; nombres: string; apellidos: string; maxCuotas?: number; estado?: string }
interface ProductoMin { id: string; codigo: string; descripcion: string; precioContado: string; permiteCredito: boolean; maxCuotasProducto: number; unidadMedida: string }
interface CompraFila { id: string; clienteId: string; cliente: ClienteMin; fechaHora: string; nCuotas: number; periodoCuota: string; capitalInicial: string; capitalFinanciado: string; tea: string; estado: string }
interface CuotaFila { numero: number; fechaVencimiento: string; saldoInicial: string; interes: string; amortizacion: string; montoCuota: string; saldoFinal: string; estado?: string }
interface Detalle extends CompraFila {
  fechaCorteCiclo: string; fechaFinGracia: string; diasGracia: number; interesGracia: string; tem: string; cuotaRegular: string;
  detalles: { id: string; cantidad: string; precioUnitarioAplicado: string; subtotal: string; producto: { codigo: string; descripcion: string; unidadMedida: string } }[];
  cuotas: (CuotaFila & { estado: string })[];
}
interface Simulacion {
  valido: boolean; errores: string[]; maxCuotasPermitidas: number; periodoCuota: string; limiteCredito: string; deudaPendiente: string; creditoDisponibleAntes: string;
  calculo: null | {
    items: { codigoProducto: string; descripcion: string; cantidad: number; precioUnitarioAplicado: string; subtotal: string }[];
    capitalInicial: string; fechaCorteCiclo: string; fechaFinGracia: string; diasGracia: number; interesGracia: string; capitalFinanciado: string;
    temPct: string; teaPct: string; cuotaRegular: string; cuotas: CuotaFila[]; totalIntereses: string; totalProgramado: string; creditoDisponibleDespues: string;
  };
}
interface ItemForm { codigo: string; cantidad: string }

const dmy = (iso: string) => fd(iso);

function DetalleCompra({ id, onCerrar }: { id: string; onCerrar: () => void }) {
  const { datos: c, error, cargando } = useCarga(() => api.get<Detalle>(`/compras/${id}`), [id]);
  if (cargando) return <Cargando />;
  if (error || !c) return <Errores error={error} />;
  return (
    <div className="card mb20">
      <div className="hdr" style={{ marginBottom: 8 }}>
        <div className="t"><h2 style={{ margin: 0 }}>Compra #{c.id} · {c.cliente.nombres} {c.cliente.apellidos}</h2><div className="sub">{fdh(c.fechaHora)} · <Insignia estado={c.estado} /></div></div>
        <Link className="btn pri" to={`/cronograma?compra=${c.id}`}>Cronograma de pagos</Link>
        <button className="btn" onClick={onCerrar}>Cerrar</button>
      </div>
      <div className="row">
        <div>
          <Kv k="Capital (precio contado)" v={money(c.capitalInicial)} />
          <Kv k="Corte del ciclo" v={dmy(c.fechaCorteCiclo)} />
          <Kv k="Fin de gracia (fecha de pago)" v={dmy(c.fechaFinGracia)} />
          <Kv k="Días de gracia" v={c.diasGracia} />
          <Kv k="Interés de gracia" v={money(c.interesGracia)} />
          <Kv k="Capital financiado" v={money(c.capitalFinanciado)} grande />
          <Kv k={siglaTasa(c.periodoCuota)} v={pct(Number(c.tem) * 100, 7)} />
          <Kv k="TEA" v={pct(c.tea, 7)} />
          <Kv k="Cuota regular" v={money(c.cuotaRegular)} />
        </div>
        <div style={{ flex: 2 }}>
          <Tabla>
            <thead><tr><th>Producto</th><th className="r">Cant.</th><th className="r">P. unit.</th><th className="r">Subtotal</th></tr></thead>
            <tbody>{c.detalles.map((d) => <tr key={d.id}><td>{d.producto.descripcion}<div className="m sm">{d.producto.codigo}</div></td><td className="r">{Number(d.cantidad)}</td><td className="r">{money(d.precioUnitarioAplicado)}</td><td className="r">{money(d.subtotal)}</td></tr>)}</tbody>
          </Tabla>
        </div>
      </div>
      <Tabla>
        <thead><tr><th>Cuota</th><th>Vence</th><th className="r">Saldo inicial</th><th className="r">Interés</th><th className="r">Amortización</th><th className="r">Importe</th><th className="r">Saldo final</th><th>Estado</th></tr></thead>
        <tbody>{c.cuotas.map((q) => <tr key={q.numero}><td>{q.numero}</td><td>{dmy(q.fechaVencimiento)}</td><td className="r">{money(q.saldoInicial)}</td><td className="r">{money(q.interes)}</td><td className="r">{money(q.amortizacion)}</td><td className="r b">{money(q.montoCuota)}</td><td className="r">{money(q.saldoFinal)}</td><td><Insignia estado={q.estado} /></td></tr>)}</tbody>
      </Tabla>
    </div>
  );
}

function NuevaCompra({ onListo, onCancelar }: { onListo: (id: string) => void; onCancelar: () => void }) {
  const clientes = useCarga(() => api.get<ClienteMin[]>('/clientes?estado=ACTIVO'), []);
  const productos = useCarga(() => api.get<ProductoMin[]>('/productos?estado=ACTIVO'), []);
  const [clienteId, setClienteId] = useState('');
  const [fechaHora, setFechaHora] = useState(ahoraLocal());
  const [items, setItems] = useState<ItemForm[]>([{ codigo: '', cantidad: '1' }]);
  const [nCuotas, setNCuotas] = useState(String(CUOTAS_FIJAS));
  const [periodoCuota, setPeriodoCuota] = useState('MENSUAL');
  const [sim, setSim] = useState<Simulacion | null>(null);
  const [errSim, setErrSim] = useState<string | null>(null);
  const [errReg, setErrReg] = useState<string | null>(null);
  const [registrando, setRegistrando] = useState(false);

  const credito = (productos.datos ?? []).filter((p) => p.permiteCredito);
  const completos = items.filter((i) => i.codigo && Number(i.cantidad) > 0);
  const cuerpo = { clienteId, fechaHora, nCuotas: Number(nCuotas), periodoCuota, items: completos.map((i) => ({ codigoProducto: i.codigo, cantidad: Number(i.cantidad) })) };
  const clave = JSON.stringify(cuerpo);

  useEffect(() => {
    if (!clienteId || !completos.length || !(Number(nCuotas) >= 1)) { setSim(null); setErrSim(null); return; }
    const t = setTimeout(() => {
      api.post<Simulacion>('/compras/simular', cuerpo).then((r) => { setSim(r); setErrSim(null); })
        .catch((e) => { setSim(null); setErrSim(e instanceof ApiError ? e.message : 'No se pudo calcular'); });
    }, 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clave]);

  const setItem = (k: number, p: Partial<ItemForm>) => setItems((xs) => xs.map((x, i) => (i === k ? { ...x, ...p } : x)));

  async function registrar() {
    setErrReg(null);
    setRegistrando(true);
    try {
      const r = await api.post<{ id: string }>('/compras', cuerpo);
      onListo(r.id);
    } catch (e) {
      setErrReg(e instanceof ApiError ? e.mensajes.join(' · ') : 'No se pudo registrar');
    } finally {
      setRegistrando(false);
    }
  }

  const c = sim?.calculo;
  return (
    <div className="row">
      <div className="card" style={{ flex: 2 }}>
        <h2>Nueva compra al crédito</h2>
        <div className="frow">
          <Campo label="Cliente" ayuda="Quién compra. Solo aparecen clientes activos. Su tasa, límite, corte y pago definen el cálculo.">
            <select value={clienteId} onChange={(e) => setClienteId(e.target.value)} required>
              <option value="">Selecciona…</option>
              {clientes.datos?.map((c) => <option key={c.id} value={c.id}>{c.apellidos}, {c.nombres} (DNI {c.dni})</option>)}
            </select>
          </Campo>
          <Campo label="Fecha y hora de la compra" ayuda="Momento de la compra (hora de Lima). Si es posterior a la hora de corte del cliente, la compra pasa al ciclo siguiente.">
            <input type="datetime-local" value={fechaHora} onChange={(e) => setFechaHora(e.target.value)} required />
          </Campo>
          <Campo label="Tipo de tasa efectiva (período de las cuotas)" ayuda="Cada cuánto se paga una cuota y a qué período se convierte la tasa del cliente: diaria (TED), quincenal (TEQ), mensual (TEM), bimestral (TEB), trimestral (TET), cuatrimestral (TEC), semestral (TES) o anual (TEA). Las cuotas vencen cada ese período, contado en días de 30/360." ancho={230}>
            <select value={periodoCuota} onChange={(e) => setPeriodoCuota(e.target.value)}>
              {PERIODOS_CUOTA.map((p) => <option key={p.valor} value={p.valor}>{p.texto}</option>)}
            </select>
          </Campo>
          <Campo label="Número de cuotas" ayuda={`Todos los créditos se otorgan en exactamente ${CUOTAS_FIJAS} cuotas (mínimo y máximo).`} ancho={150}>
            <input type="number" value={CUOTAS_FIJAS} readOnly />
          </Campo>
        </div>

        <div className="b" style={{ margin: '4px 0 8px' }}>Productos</div>
        {items.map((it, k) => (
          <div className="itemrow" key={k}>
            <Campo label={k === 0 ? 'Producto' : ' '} ayuda="Producto o servicio que se lleva. Solo se muestran los que se venden al crédito.">
              <select value={it.codigo} onChange={(e) => setItem(k, { codigo: e.target.value })}>
                <option value="">Selecciona…</option>
                {credito.map((p) => <option key={p.id} value={p.codigo}>{p.descripcion} — {money(p.precioContado)}</option>)}
              </select>
            </Campo>
            <Campo label={k === 0 ? 'Cantidad' : ' '} ayuda="Cuántas unidades (admite hasta 3 decimales, ej. 1.5 kg)." ancho={110}>
              <input type="number" min="0.001" step="0.001" value={it.cantidad} onChange={(e) => setItem(k, { cantidad: e.target.value })} />
            </Campo>
            <button type="button" className="btn sm danger" style={{ marginTop: k === 0 ? 28 : 6 }} disabled={items.length === 1} onClick={() => setItems((xs) => xs.filter((_, i) => i !== k))}>Quitar</button>
          </div>
        ))}
        <button type="button" className="btn sm" onClick={() => setItems((xs) => [...xs, { codigo: '', cantidad: '1' }])}>+ Agregar producto</button>

        {errSim && <Errores error={errSim} />}
        {sim && !sim.valido && <Errores error={sim.errores} />}
        <Errores error={errReg} />
        <div className="mt16" style={{ display: 'flex', gap: 10 }}>
          <button className="btn pri" disabled={!sim?.valido || registrando} onClick={registrar}>{registrando ? 'Registrando…' : 'Registrar compra'}</button>
          <button className="btn" onClick={onCancelar}>Cancelar</button>
        </div>
      </div>

      <div className="card side340" style={{ alignSelf: 'flex-start' }}>
        <h2>Cálculo en vivo</h2>
        {!sim ? <div className="m">Elige cliente, productos y cuotas para ver el cálculo.</div> : (
          <>
            <Kv k="Crédito disponible antes" v={money(sim.creditoDisponibleAntes)} />
            {c && (
              <>
                <Kv k="Capital (contado)" v={money(c.capitalInicial)} />
                <Kv k="Corte del ciclo" v={dmy(c.fechaCorteCiclo)} />
                <Kv k="Fecha de pago (fin de gracia)" v={dmy(c.fechaFinGracia)} />
                <Kv k="Días de gracia" v={c.diasGracia} />
                <Kv k="Interés de gracia" v={money(c.interesGracia)} />
                <Kv k="Capital financiado" v={money(c.capitalFinanciado)} />
                <Kv k={siglaTasa(sim?.periodoCuota)} v={pct(c.temPct, 7)} />
                <Kv k="TEA" v={pct(c.teaPct, 7)} />
                <Kv k="Cuota regular" v={money(c.cuotaRegular)} grande />
                <Kv k="Total de intereses" v={money(c.totalIntereses)} />
                <Kv k="Crédito disponible después" v={money(c.creditoDisponibleDespues)} />
                <div className="b mt16 sm">Cronograma</div>
                <Tabla>
                  <thead><tr><th>N°</th><th>Vence</th><th className="r">Importe</th></tr></thead>
                  <tbody>{c.cuotas.map((q) => <tr key={q.numero}><td>{q.numero}</td><td>{dmy(q.fechaVencimiento)}</td><td className="r">{money(q.montoCuota)}</td></tr>)}</tbody>
                </Tabla>
              </>
            )}
            {sim.valido && <div className="note good">La compra es válida y se puede registrar.</div>}
          </>
        )}
      </div>
    </div>
  );
}

export default function Compras() {
  const [params, setParams] = useSearchParams();
  const nav = useNavigate();
  const ver = params.get('ver');
  const nueva = params.get('nueva') === '1';
  const [clienteId, setClienteId] = useState('');
  const { datos, error, cargando, recargar } = useCarga(() => api.get<CompraFila[]>(`/compras${clienteId ? `?clienteId=${clienteId}` : ''}`), [clienteId]);
  const clientes = useCarga(() => api.get<ClienteMin[]>('/clientes'), []);

  return (
    <>
      <Encabezado ruta="Compras" titulo="Compras al crédito" sub="Registro de ventas fiadas. El cronograma de pagos se entrega al cliente.">
        {!nueva && <button className="btn pri" onClick={() => setParams({ nueva: '1' })}>+ Nueva compra al crédito</button>}
      </Encabezado>

      {nueva && <NuevaCompra onCancelar={() => setParams({})} onListo={(id) => { recargar(); nav(`/compras?ver=${id}`); }} />}
      {ver && <DetalleCompra id={ver} onCerrar={() => setParams({})} />}

      <div className="card">
        <div className="tools">
          <select value={clienteId} onChange={(e) => setClienteId(e.target.value)}>
            <option value="">Todos los clientes</option>
            {clientes.datos?.map((c) => <option key={c.id} value={c.id}>{c.apellidos}, {c.nombres}</option>)}
          </select>
        </div>
        {cargando && !datos ? <Cargando /> : error ? <Errores error={error} /> : !datos?.length ? <Vacio texto="No hay compras registradas." /> : (
          <Tabla>
            <thead><tr><th>N°</th><th>Cliente</th><th>Fecha</th><th>Cuotas</th><th className="r">Capital</th><th className="r">Financiado</th><th className="r">TEA</th><th>Estado</th><th /></tr></thead>
            <tbody>
              {datos.map((c) => (
                <tr key={c.id} className="click" onClick={() => setParams({ ver: c.id })}>
                  <td>#{c.id}</td><td className="b">{c.cliente.apellidos}, {c.cliente.nombres}</td>
                  <td>{fdh(c.fechaHora)}</td><td>{c.nCuotas}</td>
                  <td className="r">{money(c.capitalInicial)}</td><td className="r">{money(c.capitalFinanciado)}</td><td className="r">{pct(c.tea, 2)}</td>
                  <td><Insignia estado={c.estado} /></td><td className="r"><button className="btn sm">Ver</button></td>
                </tr>
              ))}
            </tbody>
          </Tabla>
        )}
      </div>
    </>
  );
}
