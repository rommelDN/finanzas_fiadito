import type Decimal from 'decimal.js';
import { Dec, dec } from './decimal';

/** Días de cada periodo de tasa (Anexo A: mes de 30 días, año de 360). */
export const PERIODOS = {
  DIARIA: 1,
  QUINCENAL: 15,
  MENSUAL: 30,
  BIMESTRAL: 60,
  TRIMESTRAL: 90,
  CUATRIMESTRAL: 120,
  SEMESTRAL: 180,
  ANUAL: 360,
} as const;
export type Periodo = keyof typeof PERIODOS;

/** Tasa efectiva de `p` días (en %), llevada a `d` días: (1+i)^(d/p) − 1. Devuelve decimal. */
export const tasaPeriodo = (tasaPct: Decimal.Value, p: number, d: number): Dec =>
  dec(1)
    .plus(dec(tasaPct).div(100))
    .pow(dec(d).div(p))
    .minus(1);

export interface TasasCliente {
  p: number;
  pMora: number;
  tem: Dec;
  /** TEA de interés en decimal (×100 para %). */
  teaInteres: Dec;
  teaMora: Dec;
}

export const calcularTasas = (c: {
  tasaInteres: Decimal.Value;
  periodoTasa: Periodo;
  tasaMora: Decimal.Value;
  periodoTasaMora: Periodo;
}): TasasCliente => {
  const p = PERIODOS[c.periodoTasa];
  const pMora = PERIODOS[c.periodoTasaMora];
  return {
    p,
    pMora,
    tem: tasaPeriodo(c.tasaInteres, p, 30),
    teaInteres: tasaPeriodo(c.tasaInteres, p, 360),
    teaMora: tasaPeriodo(c.tasaMora, pMora, 360),
  };
};
