import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ApiError, api } from '../api';
import { Campo, Cargando, Encabezado, Errores, Insignia, Kv, MEDIOS, Tabla, Vacio, fd, money, pct, useCarga } from '../ui';

interface CompraFila { id: string; clienteId: string; cliente: { id: string; dni: string; nombres: string; apellidos: string }; fechaHora: string; nCuotas: number; capitalInicial: string; estado: string }
interface CuotaFila {
  numero: number; fechaVencimiento: string; saldoInicial: string; interes: string; amortizacion: string; montoCuota: string; saldoFinal: string; estado: 'PENDIENTE' | 'PAGADA';
  pago: null | { fechaPagoReal: string; diasMora: number; montoMora: string; montoTotal: string; medioPago: string };
}
interface Cronograma {
  vistaPrevia: boolean; editable: boolean; motivoNoEditable: string | null;
  compra: { id: string; estado: string; fechaHora: string; nCuotas: number; cliente: { id: string; nombre: string; dni: string } };
  proxima: null | { cuotaId: string; numero: number; fechaVencimiento: string; montoCuota: string; diasMoraSugeridos: number };
  resumen: { capitalInicial: string; diasGracia: number; fechaFinGracia: string; interesGracia: string; capitalFinanciado: string; temPct: string; teaPct: string; cuotaRegular: string; totalIntereses: string; totalProgramado: string };
  cuotas: CuotaFila[];
}
interface PagoCalc {
  numero: number; nCuotas: number; fechaVencimiento: string; diasMora: number; diasMoraSugeridos: number; tasaMoraPeriodoPct: string;
  capital: string; intereses: string; mora: string; totalPagar: string; imputacion: { mora: string; intereses: string; capital: string };
}

const nombre = (c: CompraFila['cliente']) => `${c.apellidos}, ${c.nombres}`;

export default function CronogramaPagos() {
  const [params, setParams] = useSearchParams();
  const compras = useCarga(() => api.get<CompraFila[]>('/compras'), []);
  const compraId = params.get('compra') ?? '';
  const [clienteId, setClienteId] = useState('');

  // Si se llega con ?compra=, se preselecciona su cliente.
  useEffect(() => {
    const c = compras.datos?.find((x) => x.id === compraId);
    if (c) setClienteId(c.clienteId);
  }, [compraId, compras.datos]);

  const clientes = [...new Map((compras.datos ?? []).map((c) => [c.clienteId, c.cliente])).entries()];
  const delCliente = (compras.datos ?? []).filter((c) => c.clienteId === clienteId);

  return (
    <>
      <Encabezado ruta="Cronograma de pagos" titulo="Cronograma de pagos" sub="Cuotas del método francés de cada compra: define los días de gracia, controla la mora y cobra la próxima cuota." />
      <div className="card mb20">
        {compras.cargando && !compras.datos ? <Cargando /> : compras.error ? <Errores error={compras.error} /> : !compras.datos?.length ? (
          <Vacio texto="Aún no hay compras al crédito. Registra una en Compras para ver su cronograma." />
        ) : (
          <div className="frow">
            <Campo label="Cliente" ayuda="Cliente que tiene el crédito. Solo aparecen quienes ya compraron al crédito.">
              <select value={clienteId} onChange={(e) => { setClienteId(e.target.value); setParams({}); }}>
                <option value="">Selecciona…</option>
                {clientes.map(([id, c]) => <option key={id} value={id}>{nombre(c)} (DNI {c.dni})</option>)}
              </select>
            </Campo>
            <Campo label="Compra" ayuda="Compra al crédito cuyo cronograma quieres ver. Entre paréntesis, su estado.">
              <select value={compraId} onChange={(e) => setParams(e.target.value ? { compra: e.target.value } : {})} disabled={!clienteId}>
                <option value="">Selecciona…</option>
                {delCliente.map((c) => <option key={c.id} value={c.id}>#{c.id} · {fd(c.fechaHora)} · {money(c.capitalInicial)} en {c.nCuotas} cuotas ({c.estado})</option>)}
              </select>
            </Campo>
          </div>
        )}
      </div>
      {compraId && <Detalle key={compraId} id={compraId} />}
    </>
  );
}

function Detalle({ id }: { id: string }) {
  // Días de gracia en edición; al cambiar se pide una vista previa sin guardar.
  const [gracia, setGracia] = useState<string>('');
  const [vista, setVista] = useState<Cronograma | null>(null);
  const [errGracia, setErrGracia] = useState<string | null>(null);
  const [aplicando, setAplicando] = useState(false);
  const [ok, setOk] = useState<string | null>(null);
  const base = useCarga(() => api.get<Cronograma>(`/cronograma/${id}`), [id]);

  useEffect(() => {
    if (base.datos && gracia === '') setGracia(String(base.datos.resumen.diasGracia));
  }, [base.datos, gracia]);

  useEffect(() => {
    if (!base.datos || gracia === '') return;
    const dias = Number(gracia);
    if (!Number.isInteger(dias) || dias < 0 || dias > 90) { setVista(null); setErrGracia('Los días de gracia deben ser un entero entre 0 y 90'); return; }
    setErrGracia(null);
    if (dias === base.datos.resumen.diasGracia) { setVista(null); return; }
    const t = setTimeout(() => {
      api.get<Cronograma>(`/cronograma/${id}?diasGracia=${dias}`).then(setVista).catch((e) => setErrGracia(e instanceof ApiError ? e.message : 'No se pudo calcular'));
    }, 300);
    return () => clearTimeout(t);
  }, [gracia, base.datos, id]);

  async function aplicarGracia() {
    setErrGracia(null);
    setAplicando(true);
    try {
      await api.patch(`/cronograma/${id}/gracia`, { diasGracia: Number(gracia) });
      setVista(null);
      await base.recargar();
    } catch (e) {
      setErrGracia(e instanceof ApiError ? e.mensajes.join(' · ') : 'No se pudo aplicar');
    } finally {
      setAplicando(false);
    }
  }

  if (base.cargando && !base.datos) return <Cargando />;
  if (base.error || !base.datos) return <Errores error={base.error} />;
  const c = base.datos;
  const mostrado = vista ?? c;
  const r = mostrado.resumen;
  const previa = !!vista;

  return (
    <>
      <div className="row">
        <div className="card">
          <h2>Compra #{c.compra.id} · {c.compra.cliente.nombre} <Insignia estado={c.compra.estado} /></h2>
          <Campo label="Días de gracia" ayuda="Días entre la compra y el primer pago. Durante la gracia no se paga, pero la deuda crece con la tasa de esos días (se capitaliza). Más gracia = cuotas un poco más altas. De 0 a 90.">
            <input type="number" min="0" max="90" value={gracia} onChange={(e) => setGracia(e.target.value)} disabled={!c.editable} />
          </Campo>
          {!c.editable && <div className="note warn">{c.motivoNoEditable}</div>}
          {c.editable && previa && (
            <div className="note info">
              Vista previa con {gracia} días de gracia (el cronograma guardado tiene {c.resumen.diasGracia}). Nada se ha guardado todavía.
              <div className="mt8" style={{ display: 'flex', gap: 8 }}>
                <button className="btn pri sm" onClick={aplicarGracia} disabled={aplicando}>{aplicando ? 'Aplicando…' : 'Aplicar días de gracia'}</button>
                <button className="btn sm" onClick={() => setGracia(String(c.resumen.diasGracia))}>Descartar</button>
              </div>
            </div>
          )}
          <Errores error={errGracia} />
        </div>
        <div className="card">
          <h2>Resumen del crédito {previa && <span className="badge amb">Vista previa</span>}</h2>
          <Kv k="Capital (precio al contado)" v={money(r.capitalInicial)} />
          <Kv k="Días de gracia" v={r.diasGracia} />
          <Kv k="Fin de gracia (primer pago un mes después)" v={fd(r.fechaFinGracia)} />
          <Kv k="Interés de la gracia" v={money(r.interesGracia)} />
          <Kv k="Capital financiado" v={money(r.capitalFinanciado)} />
          <Kv k="TEM / TEA" v={`${pct(r.temPct, 4)} / ${pct(r.teaPct, 4)}`} />
          <Kv k="Cuota regular" v={money(r.cuotaRegular)} grande />
          <Kv k="Total de intereses" v={money(r.totalIntereses)} />
          <Kv k="Total a pagar en cuotas" v={money(r.totalProgramado)} />
        </div>
      </div>

      <div className="card mb20">
        <h2>Cronograma (método francés) {previa && <span className="badge amb">Vista previa</span>}</h2>
        <Tabla>
          <thead>
            <tr><th>N°</th><th>Vence</th><th className="r">Saldo inicial</th><th className="r">Interés</th><th className="r">Amortización</th><th className="r">Cuota</th><th className="r">Saldo final</th><th>Estado</th></tr>
          </thead>
          <tbody>
            {mostrado.cuotas.map((q) => {
              const esProxima = !previa && c.proxima?.numero === q.numero;
              return (
                <tr key={q.numero} style={esProxima ? { background: 'var(--pri-s)' } : undefined}>
                  <td className="b">{q.numero}</td><td>{fd(q.fechaVencimiento)}</td>
                  <td className="r">{money(q.saldoInicial)}</td><td className="r">{money(q.interes)}</td><td className="r">{money(q.amortizacion)}</td>
                  <td className="r b">{money(q.montoCuota)}</td><td className="r">{money(q.saldoFinal)}</td>
                  <td>
                    <Insignia estado={q.estado} />
                    {q.pago && <div className="m sm">{fd(q.pago.fechaPagoReal)} · {q.pago.diasMora} d. mora · {money(q.pago.montoTotal)}</div>}
                    {esProxima && <div className="sm" style={{ color: 'var(--pri)', fontWeight: 600 }}>Próxima</div>}
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr><td colSpan={3}>Totales</td><td className="r">{money(mostrado.cuotas.reduce((s, q) => s + Number(q.interes), 0))}</td><td className="r">{money(mostrado.cuotas.reduce((s, q) => s + Number(q.amortizacion), 0))}</td><td className="r">{money(r.totalProgramado)}</td><td colSpan={2} /></tr>
          </tfoot>
        </Tabla>
        <div className="sm m mt8"><Link to={`/compras?ver=${id}`} style={{ color: 'var(--pri)' }}>Ver los productos de esta compra</Link></div>
      </div>

      {ok && <div className="note good mb20">{ok}</div>}
      {previa ? (
        <div className="note warn">Aplica o descarta la vista previa de los días de gracia para poder cobrar cuotas.</div>
      ) : c.proxima ? (
        <PagoProxima key={`${id}-${c.proxima.numero}`} compraId={id} cronograma={c} onPagado={async (m) => { setOk(m); await base.recargar(); }} />
      ) : (
        <div className="note good">Todas las cuotas de esta compra están pagadas.</div>
      )}
    </>
  );
}

function PagoProxima({ compraId, cronograma, onPagado }: { compraId: string; cronograma: Cronograma; onPagado: (mensaje: string) => Promise<unknown> }) {
  const proxima = cronograma.proxima!;
  const [dias, setDias] = useState(String(proxima.diasMoraSugeridos));
  const [medio, setMedio] = useState('EFECTIVO');
  const [calc, setCalc] = useState<PagoCalc | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    setCalc(null);
    const n = Number(dias);
    if (dias === '' || !Number.isInteger(n) || n < 0 || n > 3650) { setErr('Los días de mora deben ser un entero entre 0 y 3650'); return; }
    setErr(null);
    let vigente = true;
    const t = setTimeout(() => {
      api.get<PagoCalc>(`/cronograma/${compraId}/pago?diasMora=${n}`)
        .then((r) => { if (vigente) setCalc(r); })
        .catch((e) => { if (vigente) setErr(e instanceof ApiError ? e.message : 'No se pudo calcular'); });
    }, 250);
    return () => { vigente = false; clearTimeout(t); };
  }, [dias, compraId]);

  async function pagar() {
    if (!calc) return;
    if (!confirm(`¿Registrar el pago de la cuota ${calc.numero} por ${money(calc.totalPagar)}?`)) return;
    setEnviando(true);
    setErr(null);
    try {
      await api.post(`/cronograma/${compraId}/pagar`, { numeroCuota: calc.numero, medioPago: medio, montoPagado: Number(calc.totalPagar), diasMora: calc.diasMora });
      await onPagado(`Cuota ${calc.numero} pagada: ${money(calc.totalPagar)}.`);
    } catch (e) {
      setErr(e instanceof ApiError ? e.mensajes.join(' · ') : 'No se pudo registrar el pago');
    } finally {
      setEnviando(false);
    }
  }

  return (
    <>
      <div className="row">
        <div className="card">
          <h2>Cobrar la cuota {proxima.numero} de {cronograma.compra.nCuotas}</h2>
          <Kv k="Vencimiento" v={fd(proxima.fechaVencimiento)} />
          <Kv k="Importe de la cuota" v={money(proxima.montoCuota)} />
          <Campo label="Días de mora" ayuda={`Días de atraso respecto al vencimiento. La app propone ${proxima.diasMoraSugeridos} según la fecha de hoy; puedes cambiarlo. Con 0 no se cobra mora. La mora se calcula sobre la cuota con la tasa moratoria del cliente.`}>
            <input type="number" min="0" max="3650" value={dias} onChange={(e) => setDias(e.target.value)} />
          </Campo>
          <Campo label="Medio de pago" ayuda="Cómo paga el cliente: efectivo, Yape, Plin o transferencia.">
            <select value={medio} onChange={(e) => setMedio(e.target.value)}>{MEDIOS.map((m) => <option key={m}>{m}</option>)}</select>
          </Campo>
          <Errores error={err} />
          <button className="btn pri mt16" style={{ width: '100%' }} disabled={!calc || enviando} onClick={pagar}>
            {enviando ? 'Registrando…' : `Pagar ${calc ? money(calc.totalPagar) : ''}`}
          </button>
        </div>
        <div className="card">
          <h2>Cálculo del pago</h2>
          {!calc ? <div className="m">Calculando…</div> : (
            <>
              <Kv k="Días de mora" v={calc.diasMora} />
              <Kv k="Tasa de mora del periodo" v={pct(calc.tasaMoraPeriodoPct, 7)} />
              <Kv k="Capital de la cuota" v={money(calc.capital)} />
              <Kv k="Interés de la cuota" v={money(calc.intereses)} />
              <Kv k="Intereses por mora" v={money(calc.mora)} />
              <Kv k="TOTAL A PAGAR" v={money(calc.totalPagar)} grande />
              <div className="note info">El pago se imputa primero a la mora ({money(calc.imputacion.mora)}), luego al interés ({money(calc.imputacion.intereses)}) y al final al capital ({money(calc.imputacion.capital)}). No hay pagos parciales.</div>
            </>
          )}
        </div>
      </div>
    </>
  );
}
