import { FormEvent, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { ApiError } from '../api';
import { useAuth } from '../auth';
import { Campo, Errores } from '../ui';

export default function Login() {
  const { usuario, login } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  if (usuario) return <Navigate to="/" replace />;

  async function enviar(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setEnviando(true);
    try {
      await login(username.trim(), password);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No se pudo iniciar sesión');
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="login">
      <div className="brand">
        <div className="logo" style={{ padding: 0 }}>
          <div className="sq">F</div>
          <b>Fiadito</b>
        </div>
        <div>
          <h2>El cuaderno de fiado, ahora con cuentas claras.</h2>
          <div>Cada compra al crédito con su cronograma, su estado de cuenta y su pago: sin cálculos a mano.</div>
          <div className="chkl">✓ Cuotas y tasas calculadas por la app</div>
          <div className="chkl">✓ Estado de cuenta en cada fecha de corte</div>
          <div className="chkl">✓ Varias tiendas en la misma plataforma</div>
        </div>
        <small>SI642 Finanzas e Ingeniería Económica · UPC</small>
      </div>
      <div className="formz">
        <form className="card" onSubmit={enviar}>
          <h2>Iniciar sesión</h2>
          <div className="sub mb20">Ingresa con el usuario que te dio tu tienda.</div>
          <Campo label="Usuario" ayuda="Tu nombre de usuario. Lo entrega el administrador de tu tienda.">
            <input value={username} onChange={(e) => setUsername(e.target.value)} autoFocus autoComplete="username" required maxLength={40} />
          </Campo>
          <Campo label="Contraseña" ayuda="Tu clave personal. Se guarda cifrada y nunca se muestra.">
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required maxLength={100} />
          </Campo>
          <Errores error={error} />
          <button className="btn pri mt16" style={{ width: '100%' }} disabled={enviando}>
            {enviando ? 'Ingresando…' : 'Ingresar'}
          </button>
        </form>
      </div>
    </div>
  );
}
