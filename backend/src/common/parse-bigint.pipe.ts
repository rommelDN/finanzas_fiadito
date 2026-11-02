import { BadRequestException, Injectable, PipeTransform } from '@nestjs/common';

/** Convierte el :id de la URL a bigint (los ids de la BD son BIGINT). */
@Injectable()
export class ParseBigIntPipe implements PipeTransform<string, bigint> {
  transform(v: string): bigint {
    if (!/^\d{1,18}$/.test(v)) throw new BadRequestException('Id inválido');
    return BigInt(v);
  }
}

/** Fecha 'YYYY-MM-DD' → Date UTC a medianoche (columnas DATE). */
export const fechaUTC = (iso: string): Date => new Date(`${iso}T00:00:00Z`);
