import { Encabezado } from '../ui';

const PASOS = [
  ['Registra al cliente', 'Define su tasa pactada, límite de crédito, máximo de cuotas, día de corte y día de pago. La app valida la tasa contra los topes del BCRP.'],
  ['Registra la compra', 'Elige los productos y el número de cuotas. La app calcula al instante el corte, los días de gracia, la cuota y el crédito que le queda.'],
  ['Llega el corte', 'En la fecha de corte se genera el estado de cuenta con las cuotas que vencen en el ciclo, ordenadas por fecha de compra.'],
  ['Cobra el pago', 'El cliente paga el total en su fecha de pago. Si se atrasa, se suma la mora por los días de retraso.'],
  ['Libera el crédito', 'Al pagar, su crédito disponible aumenta solo en el capital amortizado.'],
];

const REGLAS: [string, string][] = [
  ['Gracia total', 'Desde la compra hasta la fecha de pago del ciclo no se paga nada, pero la deuda crece: el capital se capitaliza con la tasa de esos días antes de calcular la cuota.'],
  ['Cuotas (método francés)', 'Cuotas mensuales iguales, vencidas, con meses de 30 días. La última cuota ajusta los centavos de redondeo.'],
  ['Ciclo de corte', 'Una compra hecha hasta la hora de corte entra al ciclo de ese mes; si es posterior, pasa al mes siguiente. Las cuotas vencen desde el mes siguiente al primer día de pago.'],
  ['Mora', 'Se cobra solo sobre lo vencido (capital + interés de la cuota), con la tasa moratoria pactada, por los días entre el vencimiento y el pago real.'],
  ['Prelación del pago', 'El pago se imputa primero a la mora, luego a los intereses y al final al capital.'],
  ['Sin pagos parciales', 'Un estado de cuenta se paga completo y una sola vez. Un monto distinto al total se rechaza.'],
  ['Límite de crédito', 'Deuda = capital financiado − amortizaciones pagadas (sin intereses futuros ni mora). No se aceptan compras que superen el crédito disponible.'],
];

const FORMULAS: [string, string][] = [
  ['Conversión de tasas', 'TE(d días) = (1 + i)^(d / p) − 1      TEM = (1 + i)^(30 / p) − 1      TEA = (1 + i)^(360 / p) − 1'],
  ['Días entre fechas (30E/360)', 'd = 360·(A₂ − A₁) + 30·(M₂ − M₁) + (D₂ − D₁), con D = mín(día, 30)'],
  ['Capital financiado', 'Cg = C · (1 + TE gracia)      C = Σ cantidad × precio al contado'],
  ['Cuota francesa', 'R = Cg · TEM / (1 − (1 + TEM)^(−n))      Interés_k = Saldo_(k−1) · TEM'],
  ['Mora', 'Mora = saldo vencido · ((1 + i mora)^(días / p mora) − 1)'],
];

export default function ComoFunciona() {
  return (
    <>
      <Encabezado ruta="Cómo funciona" titulo="Cómo funciona Fiadito" sub="Del registro de la compra al cobro del estado de cuenta." />
      <div className="flow mb20">
        {PASOS.map(([t, d], i) => (
          <div className="card" key={t}>
            <div className="n">{i + 1}</div>
            <div className="b" style={{ marginBottom: 6 }}>{t}</div>
            <div className="m sm">{d}</div>
          </div>
        ))}
      </div>
      <div className="row">
        <div className="card">
          <h2>Reglas del crédito</h2>
          {REGLAS.map(([t, d]) => <p key={t} style={{ marginBottom: 12 }}><b>{t}.</b> <span className="m">{d}</span></p>)}
        </div>
        <div className="card">
          <h2>Fórmulas</h2>
          <p className="m sm" style={{ marginBottom: 12 }}>Base de 360 días, meses de 30 días. Importes redondeados a 2 decimales; las tasas se manejan con precisión completa. No hay comisiones ni seguros: el único indicador de costo es la TEA.</p>
          {FORMULAS.map(([t, f]) => (
            <div key={t} style={{ marginBottom: 12 }}>
              <div className="b">{t}</div>
              <code style={{ display: 'block', background: 'var(--head)', padding: '8px 10px', borderRadius: 6, fontSize: 12, overflowX: 'auto' }}>{f}</code>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
