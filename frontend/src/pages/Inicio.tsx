import { Link } from 'react-router-dom';
import { api } from '../api';
import { BarraUso, Cargando, Encabezado, Errores, Kpi, Tabla, Vacio, fd, fdh, money, useCarga } from '../ui';

interface CuotaRes { cuotaId: string; compraId: string; cliente: string; numero: number; nCuotas: number; fechaVencimiento: string; montoCuota: string }
interface Resumen {
  fecha: string;
  totales: { clientes: number; limiteCredito: string; deudaPendiente: string; creditoDisponible: string };
  proximoVencimiento: { fecha: string; cuotas: number; total: string } | null;
  enMora: { clientes: number; cuotas: number; monto: string };
  clientes: { id: string; nombre: string; limiteCredito: string; deudaPendiente: string; creditoDisponible: string; montoVencido: string; enMora: boolean }[];
  proximosVencimientos: CuotaRes[];
  cuotasVencidas: CuotaRes[];
  comprasRecientes: { id: string; cliente: string; fechaHora: string; nCuotas: number; capitalInicial: string; capitalFinanciado: string }[];
}

const MESES = ['ENE', 'FEB', 'MAR', 'ABR', 'MAY', 'JUN', 'JUL', 'AGO', 'SEP', 'OCT', 'NOV', 'DIC'];

export default function Inicio() {
  const { datos: r, error, cargando } = useCarga(() => api.get<Resumen>('/resumen'), []);
  if (cargando) return <Cargando />;
  if (error || !r) return <Errores error={error} />;

  return (
    <>
      <Encabezado ruta="Inicio" titulo="Resumen de la tienda" sub={`Situación al ${fd(r.fecha)}. Las deudas se muestran en capital (sin intereses futuros ni mora).`}>
        <Link className="btn pri" to="/compras?nueva=1">+ Nueva compra al crédito</Link>
      </Encabezado>

      <div className="row">
        <Kpi titulo="Deuda por cobrar" valor={money(r.totales.deudaPendiente)} sub={`Límite total ${money(r.totales.limiteCredito)}`} />
        <Kpi titulo="Crédito disponible" valor={money(r.totales.creditoDisponible)} sub={`${r.totales.clientes} clientes activos`} color="var(--ok)" />
        <Kpi
          titulo="Próximo vencimiento"
          valor={r.proximoVencimiento ? fd(r.proximoVencimiento.fecha) : '—'}
          sub={r.proximoVencimiento ? `${r.proximoVencimiento.cuotas} cuota(s) por ${money(r.proximoVencimiento.total)}` : 'Sin cuotas pendientes'}
        />
        <Kpi
          titulo="En mora"
          valor={money(r.enMora.monto)}
          sub={r.enMora.cuotas ? `${r.enMora.cuotas} cuota(s) vencida(s) · ${r.enMora.clientes} cliente(s)` : 'Todo al día'}
          color={r.enMora.cuotas ? 'var(--red)' : undefined}
        />
      </div>

      {r.cuotasVencidas.length > 0 && (
        <div className="card mb20" style={{ borderColor: 'var(--red-s)' }}>
          <h2 style={{ color: 'var(--red)' }}>Cuotas vencidas</h2>
          <Tabla>
            <thead><tr><th>Cliente</th><th>Compra</th><th>Cuota</th><th>Venció</th><th className="r">Importe</th><th /></tr></thead>
            <tbody>
              {r.cuotasVencidas.map((q) => (
                <tr key={q.cuotaId}>
                  <td className="b">{q.cliente}</td><td>#{q.compraId}</td><td>{q.numero}/{q.nCuotas}</td>
                  <td><span className="badge red">{fd(q.fechaVencimiento)}</span></td><td className="r">{money(q.montoCuota)}</td>
                  <td className="r"><Link className="btn sm pri" to={`/cronograma?compra=${q.compraId}`}>Cobrar</Link></td>
                </tr>
              ))}
            </tbody>
          </Tabla>
        </div>
      )}

      <div className="row">
        <div className="card" style={{ flex: 2 }}>
          <h2>Clientes</h2>
          {r.clientes.length === 0 ? <Vacio texto="Aún no hay clientes." /> : (
            <Tabla>
              <thead><tr><th>Cliente</th><th>Uso del crédito</th><th className="r">Deuda</th><th className="r">Disponible</th><th /></tr></thead>
              <tbody>
                {r.clientes.map((c) => (
                  <tr key={c.id}>
                    <td className="b">{c.nombre}</td>
                    <td style={{ minWidth: 120 }}><BarraUso usado={Number(c.deudaPendiente)} limite={Number(c.limiteCredito)} /></td>
                    <td className="r">{money(c.deudaPendiente)}</td>
                    <td className="r">{money(c.creditoDisponible)}</td>
                    <td>{c.enMora ? <span className="badge red">En mora</span> : <span className="badge ok">Al día</span>}</td>
                  </tr>
                ))}
              </tbody>
            </Tabla>
          )}
        </div>
        <div className="card side340">
          <h2>Próximos vencimientos</h2>
          {r.proximosVencimientos.length === 0 ? <Vacio texto="No hay cuotas por vencer." /> : r.proximosVencimientos.map((q) => (
            <Link className="due" key={q.cuotaId} to={`/cronograma?compra=${q.compraId}`}>
              <div className="d"><b>{q.fechaVencimiento.slice(8, 10)}</b><small>{MESES[Number(q.fechaVencimiento.slice(5, 7)) - 1]}</small></div>
              <div style={{ flex: 1 }}>
                <div className="b">{q.cliente}</div>
                <div className="m sm">Cuota {q.numero}/{q.nCuotas} · compra #{q.compraId}</div>
              </div>
              <div className="b">{money(q.montoCuota)}</div>
            </Link>
          ))}
        </div>
      </div>

      <div className="card">
        <h2>Compras recientes</h2>
        {r.comprasRecientes.length === 0 ? <Vacio texto="Todavía no hay compras al crédito." /> : (
          <Tabla>
            <thead><tr><th>N°</th><th>Cliente</th><th>Fecha</th><th>Cuotas</th><th className="r">Capital</th><th className="r">Financiado</th><th /></tr></thead>
            <tbody>
              {r.comprasRecientes.map((c) => (
                <tr key={c.id}>
                  <td>#{c.id}</td><td className="b">{c.cliente}</td>
                  <td>{fdh(c.fechaHora)}</td><td>{c.nCuotas}</td>
                  <td className="r">{money(c.capitalInicial)}</td><td className="r">{money(c.capitalFinanciado)}</td>
                  <td className="r"><Link className="btn sm" to={`/cronograma?compra=${c.id}`}>Cronograma</Link></td>
                </tr>
              ))}
            </tbody>
          </Tabla>
        )}
      </div>
    </>
  );
}
