import { FormEvent, useState } from 'react';
import { ApiError, api, qs } from '../api';
import { Campo, Cargando, Encabezado, Errores, Insignia, Tabla, UNIDADES, Vacio, money, useCarga } from '../ui';

interface Producto {
  id: string;
  codigo: string;
  descripcion: string;
  marca: string | null;
  proveedor: string | null;
  unidadMedida: string;
  imagenUrl: string | null;
  precioContado: string;
  precioCredito: string | null;
  permiteCredito: boolean;
  maxCuotasProducto: number;
  estado: string;
}

const VACIO = {
  codigo: '', descripcion: '', marca: '', proveedor: '', unidadMedida: 'UND', imagenUrl: '',
  precioContado: '', precioCredito: '', permiteCredito: true, maxCuotasProducto: '8', estado: 'ACTIVO',
};
type Form = typeof VACIO;

const Miniatura = ({ p }: { p: Producto }) =>
  p.imagenUrl ? <img className="thumb" src={p.imagenUrl} alt={p.descripcion} /> : <div className="thumb">{p.codigo.slice(0, 3)}</div>;

export default function Productos() {
  const [q, setQ] = useState('');
  const [estado, setEstado] = useState('');
  const { datos, error, cargando, recargar } = useCarga(() => api.get<Producto[]>(`/productos${qs({ q, estado })}`), [q, estado]);

  const [editando, setEditando] = useState<string | 'nuevo' | null>(null);
  const [f, setF] = useState<Form>(VACIO);
  const [archivo, setArchivo] = useState<File | null>(null);
  const [errForm, setErrForm] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((x) => ({ ...x, [k]: v }));

  function abrir(p?: Producto) {
    setErrForm(null);
    setArchivo(null);
    setEditando(p ? p.id : 'nuevo');
    setF(p ? {
      codigo: p.codigo, descripcion: p.descripcion, marca: p.marca ?? '', proveedor: p.proveedor ?? '', unidadMedida: p.unidadMedida,
      imagenUrl: p.imagenUrl ?? '', precioContado: p.precioContado, precioCredito: p.precioCredito ?? '',
      permiteCredito: p.permiteCredito, maxCuotasProducto: String(p.maxCuotasProducto), estado: p.estado,
    } : VACIO);
  }

  async function guardar(e: FormEvent) {
    e.preventDefault();
    setErrForm(null);
    setGuardando(true);
    const cuerpo: Record<string, unknown> = {
      codigo: f.codigo.trim(), descripcion: f.descripcion.trim(), unidadMedida: f.unidadMedida,
      precioContado: Number(f.precioContado), permiteCredito: f.permiteCredito, maxCuotasProducto: Number(f.maxCuotasProducto), estado: f.estado,
      marca: f.marca.trim() || undefined, proveedor: f.proveedor.trim() || undefined,
      precioCredito: f.precioCredito === '' ? undefined : Number(f.precioCredito),
      imagenUrl: f.imagenUrl.trim() || undefined,
    };
    try {
      const guardado = editando === 'nuevo' ? await api.post<Producto>('/productos', cuerpo) : await api.patch<Producto>(`/productos/${editando}`, cuerpo);
      if (archivo) {
        const fd = new FormData();
        fd.append('imagen', archivo);
        await api.post(`/productos/${guardado.id}/imagen`, fd);
      }
      setEditando(null);
      await recargar();
    } catch (err) {
      setErrForm(err instanceof ApiError ? err.mensajes.join(' · ') : 'No se pudo guardar');
    } finally {
      setGuardando(false);
    }
  }

  async function cambiarEstado(p: Producto) {
    if (p.estado === 'ACTIVO') {
      if (!confirm(`¿Dar de baja "${p.descripcion}"? Se conserva el historial pero no podrá venderse.`)) return;
      await api.del(`/productos/${p.id}`);
    } else {
      await api.patch(`/productos/${p.id}`, { estado: 'ACTIVO' });
    }
    recargar();
  }

  return (
    <>
      <Encabezado ruta="Productos" titulo="Productos y servicios" sub="Lo que tu tienda vende al crédito. Precios en soles (S/).">
        <button className="btn pri" onClick={() => abrir()}>+ Nuevo producto</button>
      </Encabezado>

      {editando && (
        <form className="card mb20" onSubmit={guardar}>
          <h2>{editando === 'nuevo' ? 'Nuevo producto' : 'Editar producto'}</h2>
          <div className="frow">
            <Campo label="Código" ayuda="Identificador interno del producto, único en tu tienda (letras, números, punto, guion). Máx. 20 caracteres.">
              <input value={f.codigo} onChange={(e) => set('codigo', e.target.value)} required maxLength={20} />
            </Campo>
            <Campo label="Descripción" ayuda="Nombre que verás al registrar una compra. Ej.: Arroz extra 5 kg.">
              <input value={f.descripcion} onChange={(e) => set('descripcion', e.target.value)} required maxLength={120} />
            </Campo>
            <Campo label="Unidad de medida" ayuda="Cómo se vende: unidad, kilo, litro, paquete o servicio (ej. recarga, corte de cabello).">
              <select value={f.unidadMedida} onChange={(e) => set('unidadMedida', e.target.value)}>{UNIDADES.map((u) => <option key={u}>{u}</option>)}</select>
            </Campo>
          </div>
          <div className="frow">
            <Campo label="Marca" ayuda="Marca del producto (opcional).">
              <input value={f.marca} onChange={(e) => set('marca', e.target.value)} maxLength={60} />
            </Campo>
            <Campo label="Proveedor" ayuda="A quién le compras este producto (opcional, si aplica).">
              <input value={f.proveedor} onChange={(e) => set('proveedor', e.target.value)} maxLength={100} />
            </Campo>
          </div>
          <div className="frow">
            <Campo label="Precio al contado" ayuda="Es el precio que se usa en todos los cálculos del crédito. La app agrega los intereses aparte.">
              <input type="number" step="0.01" min="0.01" max="250" value={f.precioContado} onChange={(e) => set('precioContado', e.target.value)} required />
            </Campo>
            <Campo label="Precio de lista (crédito)" ayuda="Precio referencial para mostrar al cliente. No entra en ningún cálculo: el interés se calcula sobre el precio al contado.">
              <input type="number" step="0.01" min="0" max="250" value={f.precioCredito} onChange={(e) => set('precioCredito', e.target.value)} />
            </Campo>
          </div>
          <div className="frow">
            <Campo label="Máximo de cuotas" ayuda="Referencial: hoy todos los créditos se otorgan en exactamente 8 cuotas, sin importar este valor.">
              <input type="number" min="1" max="8" value={f.maxCuotasProducto} onChange={(e) => set('maxCuotasProducto', e.target.value)} required />
            </Campo>
            <Campo label="Estado" ayuda="Un producto INACTIVO no se puede vender. Es la forma de darlo de baja sin perder el historial.">
              <select value={f.estado} onChange={(e) => set('estado', e.target.value)}><option>ACTIVO</option><option>INACTIVO</option></select>
            </Campo>
            <Campo label="¿Se vende al crédito?" ayuda="Si lo desmarcas (ej. recargas), el producto no podrá incluirse en compras al crédito.">
              <label style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '10px 0' }}>
                <input type="checkbox" style={{ width: 'auto' }} checked={f.permiteCredito} onChange={(e) => set('permiteCredito', e.target.checked)} /> Permite crédito
              </label>
            </Campo>
          </div>
          <div className="frow">
            <Campo label="Imagen (archivo)" ayuda="Sube una foto JPG, PNG o WEBP de hasta 2 MB. Si subes un archivo, reemplaza a la URL.">
              <input type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => setArchivo(e.target.files?.[0] ?? null)} />
            </Campo>
            <Campo label="Imagen (URL)" ayuda="Alternativa al archivo: dirección web (https://…) de la imagen.">
              <input value={f.imagenUrl} onChange={(e) => set('imagenUrl', e.target.value)} placeholder="https://…" maxLength={255} />
            </Campo>
          </div>
          <Errores error={errForm} />
          <div className="mt16" style={{ display: 'flex', gap: 10 }}>
            <button className="btn pri" disabled={guardando}>{guardando ? 'Guardando…' : 'Guardar'}</button>
            <button type="button" className="btn" onClick={() => setEditando(null)}>Cancelar</button>
          </div>
        </form>
      )}

      <div className="card">
        <div className="tools">
          <input placeholder="Buscar por código, descripción o marca…" value={q} onChange={(e) => setQ(e.target.value)} />
          <select value={estado} onChange={(e) => setEstado(e.target.value)}>
            <option value="">Todos los estados</option><option>ACTIVO</option><option>INACTIVO</option>
          </select>
        </div>
        {cargando && !datos ? <Cargando /> : error ? <Errores error={error} /> : !datos?.length ? <Vacio texto="No hay productos." /> : (
          <Tabla>
            <thead>
              <tr><th>Producto</th><th>Unidad</th><th className="r">Contado</th><th className="r">Lista (crédito)</th><th>Máx. cuotas</th><th>Crédito</th><th>Estado</th><th /></tr>
            </thead>
            <tbody>
              {datos.map((p) => (
                <tr key={p.id}>
                  <td><div className="prod"><Miniatura p={p} /><div><div className="b">{p.descripcion}</div><div className="m sm">{p.codigo}{p.marca ? ` · ${p.marca}` : ''}</div></div></div></td>
                  <td>{p.unidadMedida}</td>
                  <td className="r">{money(p.precioContado)}</td>
                  <td className="r m">{p.precioCredito ? money(p.precioCredito) : '—'}</td>
                  <td>{p.maxCuotasProducto}</td>
                  <td>{p.permiteCredito ? <span className="badge ok">Sí</span> : <span className="badge gray">No</span>}</td>
                  <td><Insignia estado={p.estado} /></td>
                  <td className="r">
                    <button className="btn sm" onClick={() => abrir(p)}>Editar</button>{' '}
                    <button className={`btn sm ${p.estado === 'ACTIVO' ? 'danger' : ''}`} onClick={() => cambiarEstado(p)}>{p.estado === 'ACTIVO' ? 'Dar de baja' : 'Reactivar'}</button>
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
