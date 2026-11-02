import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { EstadoActivo, Moneda, Prisma, UnidadMedida } from '@prisma/client';
import { unlink } from 'fs/promises';
import { basename, join } from 'path';
import { PrismaService } from '../common/prisma.service';
import { PRODUCTOS_DIR, PRODUCTOS_URL } from './uploads';

export interface DatosProducto {
  codigo: string;
  descripcion: string;
  marca?: string;
  proveedor?: string;
  unidadMedida: UnidadMedida;
  imagenUrl?: string;
  monedaPrecio?: Moneda;
  precioContado: number;
  precioCredito?: number;
  permiteCredito?: boolean;
  maxCuotasProducto?: number;
  estado?: EstadoActivo;
}

@Injectable()
export class ProductosService {
  constructor(private readonly prisma: PrismaService) {}

  listar(tiendaId: bigint, f: { estado?: EstadoActivo; q?: string }) {
    const q = f.q?.trim();
    return this.prisma.producto.findMany({
      where: {
        tiendaId,
        ...(f.estado ? { estado: f.estado } : {}),
        ...(q ? { OR: [{ codigo: { contains: q } }, { descripcion: { contains: q } }, { marca: { contains: q } }] } : {}),
      },
      orderBy: { codigo: 'asc' },
    });
  }

  async obtener(tiendaId: bigint, id: bigint) {
    const p = await this.prisma.producto.findFirst({ where: { id, tiendaId } });
    if (!p) throw new NotFoundException('Producto no encontrado');
    return p;
  }

  async crear(tiendaId: bigint, d: DatosProducto) {
    await this.exigirCodigoLibre(tiendaId, d.codigo);
    return this.prisma.producto.create({ data: { ...d, tiendaId } });
  }

  async actualizar(tiendaId: bigint, id: bigint, d: Partial<DatosProducto>) {
    await this.obtener(tiendaId, id);
    if (d.codigo) await this.exigirCodigoLibre(tiendaId, d.codigo, id);
    return this.prisma.producto.update({ where: { id }, data: d as Prisma.ProductoUpdateInput });
  }

  /** Baja lógica: el producto queda INACTIVO (no se puede comprar) pero se conserva el historial. */
  baja(tiendaId: bigint, id: bigint) {
    return this.actualizar(tiendaId, id, { estado: 'INACTIVO' });
  }

  /** Guarda la ruta de una imagen ya subida a disco y borra la anterior si era un archivo local. */
  async asignarImagen(tiendaId: bigint, id: bigint, archivo: string) {
    const anterior = (await this.obtener(tiendaId, id)).imagenUrl;
    const actualizado = await this.prisma.producto.update({
      where: { id },
      data: { imagenUrl: `${PRODUCTOS_URL}/${archivo}` },
    });
    if (anterior?.startsWith(`${PRODUCTOS_URL}/`)) {
      await unlink(join(PRODUCTOS_DIR, basename(anterior))).catch(() => undefined);
    }
    return actualizado;
  }

  private async exigirCodigoLibre(tiendaId: bigint, codigo: string, exceptoId?: bigint) {
    const otro = await this.prisma.producto.findUnique({ where: { tiendaId_codigo: { tiendaId, codigo } } });
    if (otro && otro.id !== exceptoId) throw new ConflictException(`Ya existe un producto con el código ${codigo}`);
  }
}
