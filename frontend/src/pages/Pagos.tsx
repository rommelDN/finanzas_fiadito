import { FormEvent, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ApiError, api } from '../api';
import { Campo, Cargando, Encabezado, Errores, Kv, MEDIOS, Tabla, Vacio, fd, hoyISO, money, pct, useCarga } from '../ui';

interface EstadoFila {
  id: string; fechaCorte: string; fechaPago: string; total: string; estado: 'PENDIENTE' | 'PAGADO';
  cliente: { nombres: string; apellidos: string };
  pago: { fechaPagoReal: string; montoTotal: string; montoMora: string; medioPago: string; diasMora: number } | null;
}
interface Calculo {
  fechaPago: string; diasMora: number; tasaMoraPeriodoPct: string; totalCapital: string; totalInteresesCuotas: string;
  interesesMora: string; totalPagar: string; imputacion: { mora: string; intereses: string; capital: string };
}

export default function Pagos() {
  const [params] = useSearchParams();
  const { datos: pendientes, cargando, error, recargar } = useCarga(() => api.get<EstadoFila[]>('/estados-cuenta?estado=PENDIENTE'), []);
  const historial = useCarga(() => api.get<EstadoFila[]>('/estados-cuenta?estado=PAGADO'), []);

  const [id, setId] = useState(params.get('estado') ?? '');
  const [fecha, setFecha] = useState(hoyISO());
  const [medio, setMedio] = useState('EFECTIVO');
  const [monto, setMonto] = useState('');
  const [calc, setCalc] = useState<Calculo | null>(null);
  const [errCalc, setErrCalc] = useState<string | null>(null);
  const [errPago, setErrPago] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  // Cálculo de mora y total a pagar a la fecha elegida; propone el monto exacto.
  useEffect(() => {
    setCalc(null);
    setErrCalc(null);
    if (!id || !fecha) return;
    let vigente = true;
    api.get<Calculo>(`/estados-cuenta/${id}/calculo-pago?fechaPagoReal=${fecha}`)
      .then((r) => { if (vigente) { setCalc(r); setMonto(r.totalPagar); } })
      .catch((e) => { if (vigente) setErrCalc(e instanceof ApiError ? e.message : 'No se pudo calcular'); });
    return () => { vigente = false; };
  }, [id, fecha]);

  async function pagar(e: FormEvent) {
    e.preventDefault();
    setErrPago(null);
    setOk(null);
    setEnviando(true);
    try {
      await api.post(`/estados-cuenta/${id}/pagos`, { fechaPagoReal: fecha, medioPago: medio, montoPagado: Number(monto) });
      setOk(`Pago registrado: estado de cuenta #${id} cancelado.`);
      setId('');
      setCalc(null);
      await Promise.all([recargar(), historial.recargar()]);
    } catch (err) {
      setErrPago(err instanceof ApiError ? err.mensajes.join(' · ') : 'No se pudo registrar el pago');
    } finally {
      setEnviando(false);
    }
  }

  const sel = pendientes?.find((p) => p.id === id);
  return (
    <>
      <Encabezado ruta="Pagos" titulo="Pagos" sub="Cada estado de cuenta se paga completo y una sola vez: sin pagos parciales." />
      {ok && <div className="note good mb20">{ok}</div>}
      <div className="row">
        <form className="card" style={{ flex: 2 }} onSubmit={pagar}>
          <h2>Registrar pago</h2>
          {cargando ? <Cargando /> : error ? <Errores error={error} /> : (
            <>
              <Campo label="Estado de cuenta" ayuda="Estado pendiente que el cliente va a cancelar. Se paga completo.">
                <select value={id} onChange={(e) => { setId(e.target.value); setOk(null); }} required>
                  <option value="">Selecciona…</option>
                  {pendientes?.map((p) => <option key={p.id} value={p.id}>#{p.id} · {p.cliente.apellidos}, {p.cliente.nombres} · vence {fd(p.fechaPago)} · {money(p.total)}</option>)}
                </select>
              </Campo>
              {!pendientes?.length && <div className="m">No hay estados de cuenta pendientes. Genera uno desde <Link to="/estados-cuenta" style={{ color: 'var(--pri)' }}>Estado de cuenta</Link>.</div>}
              <div className="frow">
                <Campo label="Fecha pactada de pago" ayuda="Fecha de vencimiento del estado de cuenta, definida por el día de pago del cliente. Solo lectura.">
                  <input value={sel ? fd(sel.fechaPago) : ''} disabled />
                </Campo>
                <Campo label="Fecha real de pago" ayuda="Día en que el cliente paga. Si es posterior a la fecha pactada se cobra mora por los días de atraso.">
                  <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} required />
                </Campo>
                <Campo label="Medio de pago" ayuda="Cómo pagó el cliente: efectivo, Yape, Plin o transferencia.">
                  <select value={medio} onChange={(e) => setMedio(e.target.value)}>{MEDIOS.map((m) => <option key={m}>{m}</option>)}</select>
                </Campo>
              </div>
              <Campo label="Monto pagado" ayuda="Debe ser exactamente el total a pagar calculado a la derecha. Si es menor o mayor, el sistema rechaza el pago.">
                <input type="number" step="0.01" min="0.01" value={monto} onChange={(e) => setMonto(e.target.value)} required />
              </Campo>
              <Errores error={errCalc} />
              <Errores error={errPago} />
              <button className="btn pri mt16" disabled={!calc || enviando}>{enviando ? 'Registrando…' : 'Registrar pago'}</button>
            </>
          )}
        </form>

        <div className="card side340" style={{ alignSelf: 'flex-start' }}>
          <h2>Cálculo del pago</h2>
          {!calc ? <div className="m">Selecciona un estado de cuenta y la fecha de pago.</div> : (
            <>
              <Kv k="Días de mora" v={calc.diasMora} />
              <Kv k="Tasa de mora del periodo" v={pct(calc.tasaMoraPeriodoPct, 7)} />
              <Kv k="Capital" v={money(calc.totalCapital)} />
              <Kv k="Intereses de las cuotas" v={money(calc.totalInteresesCuotas)} />
              <Kv k="Intereses por mora" v={money(calc.interesesMora)} />
              <Kv k="TOTAL A PAGAR" v={money(calc.totalPagar)} grande />
              <div className="note info">
                Imputación: mora {money(calc.imputacion.mora)} → intereses {money(calc.imputacion.intereses)} → capital {money(calc.imputacion.capital)}.
              </div>
              {Number(monto) !== Number(calc.totalPagar) && <div className="note warn">El monto no coincide con el total a pagar: el sistema lo rechazará.</div>}
            </>
          )}
        </div>
      </div>

      <div className="card">
        <h2>Pagos registrados</h2>
        {!historial.datos?.length ? <Vacio texto="Todavía no hay pagos." /> : (
          <Tabla>
            <thead><tr><th>Estado</th><th>Cliente</th><th>Pagó el</th><th className="r">Días de mora</th><th className="r">Mora</th><th>Medio</th><th className="r">Total pagado</th></tr></thead>
            <tbody>
              {historial.datos.map((p) => (
                <tr key={p.id}>
                  <td><Link to={`/estados-cuenta?ver=${p.id}`} style={{ color: 'var(--pri)', fontWeight: 600 }}>#{p.id}</Link></td>
                  <td className="b">{p.cliente.apellidos}, {p.cliente.nombres}</td>
                  <td>{p.pago ? fd(p.pago.fechaPagoReal) : '—'}</td><td className="r">{p.pago?.diasMora ?? '—'}</td>
                  <td className="r">{p.pago ? money(p.pago.montoMora) : '—'}</td><td>{p.pago?.medioPago}</td><td className="r b">{p.pago ? money(p.pago.montoTotal) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </Tabla>
        )}
      </div>
    </>
  );
}
