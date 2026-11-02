import { Navigate, NavLink, Outlet, Route, Routes } from 'react-router-dom';
import { Rol, useAuth } from './auth';
import { Cargando } from './ui';
import Clientes from './pages/Clientes';
import Compras from './pages/Compras';
import Cronograma from './pages/Cronograma';
import EstadosCuenta from './pages/EstadosCuenta';
import Inicio from './pages/Inicio';
import Login from './pages/Login';
import Parametros from './pages/Parametros';
import Productos from './pages/Productos';
import Tiendas from './pages/Tiendas';

const ETIQUETA_ROL: Record<Rol, string> = {
  ADMIN_SISTEMA: 'Administrador del sistema',
  ADMIN_NEGOCIO: 'Administrador de la tienda',
};

/** Menú lateral por rol. Los clientes de la tienda no tienen acceso al sistema. */
const MENU: { ruta: string; texto: string; roles: Rol[] }[] = [
  { ruta: '/', texto: 'Inicio', roles: ['ADMIN_NEGOCIO'] },
  { ruta: '/tiendas', texto: 'Tiendas', roles: ['ADMIN_SISTEMA'] },
  { ruta: '/productos', texto: 'Productos', roles: ['ADMIN_NEGOCIO'] },
  { ruta: '/clientes', texto: 'Clientes', roles: ['ADMIN_NEGOCIO'] },
  { ruta: '/compras', texto: 'Compras', roles: ['ADMIN_NEGOCIO'] },
  { ruta: '/cronograma', texto: 'Cronograma de pagos', roles: ['ADMIN_NEGOCIO'] },
  { ruta: '/estados-cuenta', texto: 'Estado de cuenta', roles: ['ADMIN_NEGOCIO'] },
  { ruta: '/parametros', texto: 'Parámetros', roles: ['ADMIN_SISTEMA', 'ADMIN_NEGOCIO'] },
];

function Layout() {
  const { usuario, logout } = useAuth();
  if (!usuario) return <Navigate to="/login" replace />;
  const iniciales = usuario.nombre.split(/\s+/).slice(0, 2).map((p) => p[0]).join('').toUpperCase();
  return (
    <div className="app">
      <aside>
        <div className="logo">
          <div className="sq">F</div>
          <div>
            <b>Fiadito</b>
            <small>{ETIQUETA_ROL[usuario.rol]}</small>
          </div>
        </div>
        <nav>
          {MENU.filter((m) => m.roles.includes(usuario.rol)).map((m) => (
            <NavLink key={m.ruta} to={m.ruta} end={m.ruta === '/'}>
              {m.texto}
            </NavLink>
          ))}
        </nav>
        <div className="user">
          <div className="av">{iniciales}</div>
          <div>
            <b>{usuario.nombre}</b>
            <small>{usuario.username}</small>
          </div>
          <button onClick={logout}>Salir</button>
        </div>
      </aside>
      <main>
        <Outlet />
      </main>
    </div>
  );
}

/** Restringe una ruta a ciertos roles; el resto va a su página de inicio. */
function Solo({ roles, children }: { roles: Rol[]; children: JSX.Element }) {
  const { usuario } = useAuth();
  if (!usuario || !roles.includes(usuario.rol)) return <Navigate to="/" replace />;
  return children;
}

function Raiz() {
  const { usuario } = useAuth();
  return usuario?.rol === 'ADMIN_SISTEMA' ? <Navigate to="/tiendas" replace /> : <Inicio />;
}

export default function App() {
  const { cargando } = useAuth();
  if (cargando) return <Cargando />;
  const negocio: Rol[] = ['ADMIN_NEGOCIO'];
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route element={<Layout />}>
        <Route index element={<Raiz />} />
        <Route path="tiendas" element={<Solo roles={['ADMIN_SISTEMA']}><Tiendas /></Solo>} />
        <Route path="productos" element={<Solo roles={negocio}><Productos /></Solo>} />
        <Route path="clientes" element={<Solo roles={negocio}><Clientes /></Solo>} />
        <Route path="compras" element={<Solo roles={negocio}><Compras /></Solo>} />
        <Route path="cronograma" element={<Solo roles={negocio}><Cronograma /></Solo>} />
        <Route path="estados-cuenta" element={<Solo roles={negocio}><EstadosCuenta /></Solo>} />
        <Route path="parametros" element={<Solo roles={['ADMIN_SISTEMA', 'ADMIN_NEGOCIO']}><Parametros /></Solo>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
