import { useEffect, useMemo, useState, type FormEvent } from 'react';

type Exchange = { id?: number; token: string; title: string; names: string[]; revealed: string[] };
type AdminExchange = Exchange;

function Sparkle({ className = '' }: { className?: string }) {
  return <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 2c.45 5.96 3.04 9.16 10 10-6.96.84-9.55 4.04-10 10-.45-5.96-3.04-9.16-10-10 6.96-.84 9.55-4.04 10-10Z" fill="currentColor" /></svg>;
}
function ArrowDown() {
  return <svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="m6 8 4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(path, { ...options, headers: { 'Content-Type': 'application/json', ...options.headers } });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Ocurrió un error. Intenta de nuevo.');
  return data as T;
}

export default function App() {
  const isAdmin = window.location.pathname.replace(/\/$/, '') === '/admin';
  const token = new URLSearchParams(window.location.search).get('exchange') || '';
  const [exchange, setExchange] = useState<Exchange | null>(null);
  const [loading, setLoading] = useState(!isAdmin);
  const [error, setError] = useState('');
  const [selectedName, setSelectedName] = useState('');
  const [isSpinning, setIsSpinning] = useState(false);
  const [rouletteName, setRouletteName] = useState('');
  const [result, setResult] = useState('');
  const [adminPassword, setAdminPassword] = useState('');
  const [adminReady, setAdminReady] = useState(false);
  const [exchanges, setExchanges] = useState<AdminExchange[]>([]);
  const [draftNames, setDraftNames] = useState(['', '', '', '']);
  const [title, setTitle] = useState('Intercambio navideño');
  const [editingId, setEditingId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');

  async function refreshPublic() {
    if (!token) { setLoading(false); return; }
    try { setExchange(await api<Exchange>(`/api/exchanges/${encodeURIComponent(token)}`)); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'No se encontró el intercambio.'); }
    finally { setLoading(false); }
  }
  useEffect(() => { if (!isAdmin) void refreshPublic(); }, [isAdmin, token]);

  const availableNames = useMemo(() => exchange?.names.filter((name) => !exchange.revealed.includes(name)) ?? [], [exchange]);
  const completed = !!exchange && exchange.revealed.length === exchange.names.length;

  async function login(event: FormEvent) {
    event.preventDefault(); setError('');
    try {
      const data = await api<{ exchanges: AdminExchange[] }>('/api/admin/exchanges', { headers: { 'x-admin-password': adminPassword } });
      setExchanges(data.exchanges); setAdminReady(true);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'No se pudo iniciar sesión.'); }
  }
  async function saveExchange(event: FormEvent) {
    event.preventDefault(); setError(''); setNotice('');
    const names = [...new Set(draftNames.map((name) => name.trim()).filter(Boolean))];
    if (names.length < 3) { setError('Agrega al menos 3 nombres diferentes.'); return; }
    setBusy(true);
    try {
      const saved = await api<AdminExchange>(editingId ? `/api/admin/exchanges/${editingId}` : '/api/admin/exchanges', {
        method: editingId ? 'PUT' : 'POST', headers: { 'x-admin-password': adminPassword }, body: JSON.stringify({ title, names }),
      });
      setExchanges((current) => editingId ? current.map((item) => item.id === saved.id ? saved : item) : [saved, ...current]);
      setNotice(editingId ? 'Intercambio actualizado. Se sortearon de nuevo los resultados.' : '¡Intercambio creado! Ya puedes compartir el enlace.');
      setEditingId(null); setTitle('Intercambio navideño'); setDraftNames(['', '', '', '']);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'No se pudo guardar.'); }
    finally { setBusy(false); }
  }
  function editExchange(item: AdminExchange) {
    setEditingId(item.id ?? null); setTitle(item.title); setDraftNames(item.names); setNotice(''); setError('');
  }
  async function copyLink(item: AdminExchange) {
    const link = `${window.location.origin}/?exchange=${item.token}`;
    try { await navigator.clipboard.writeText(link); setNotice('Enlace copiado. ¡Compártelo con el grupo!'); }
    catch { setNotice(link); }
  }

  async function spin() {
    if (!exchange || !selectedName || isSpinning) return;
    const picked = selectedName;
    let tick = 0; setResult(''); setIsSpinning(true);
    setRouletteName(exchange.names[Math.floor(Math.random() * exchange.names.length)]);
    const interval = window.setInterval(() => {
      tick += 1;
      const options = exchange.names.filter((name) => name !== picked);
      setRouletteName(options[Math.floor(Math.random() * options.length)]);
      if (tick >= 18) {
        window.clearInterval(interval);
        void api<{ name: string }>(`/api/exchanges/${encodeURIComponent(token)}/draw`, { method: 'POST', body: JSON.stringify({ name: picked }) })
          .then(({ name }) => { setRouletteName(name); setResult(name); setExchange((current) => current ? { ...current, revealed: [...current.revealed, picked] } : current); })
          .catch((reason) => { setError(reason instanceof Error ? reason.message : 'No se pudo revelar el resultado.'); setSelectedName(''); })
          .finally(() => setIsSpinning(false));
      }
    }, 105);
  }
  function closeResult() { setResult(''); setRouletteName(''); setSelectedName(''); }

  if (isAdmin) return <main className="app-shell setup-shell"><div className="ambient ambient-one" /><div className="ambient ambient-two" /><section className="setup-card admin-card">
    <div className="mini-mark"><Sparkle /></div><p className="eyebrow">Noche de regalos · Administración</p><h1>Tu intercambio</h1>
    {!adminReady ? <form onSubmit={login} className="admin-form"><p className="setup-copy">Inicia sesión con la contraseña de administrador que configuraste en Render.</p><input className="admin-input" type="password" autoComplete="current-password" placeholder="Contraseña de administrador" value={adminPassword} onChange={(event) => setAdminPassword(event.target.value)} required /><button className="primary-button" type="submit">Entrar <Sparkle /></button></form> : <>
      <form onSubmit={saveExchange} className="admin-form"><p className="setup-copy">Agrega participantes. El enlace de cada intercambio es privado para compartir con tu grupo.</p><input className="admin-input" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Nombre del intercambio" maxLength={80} required /><div className="name-fields">{draftNames.map((name, index) => <div className="name-field" key={index}><span>{String(index + 1).padStart(2, '0')}</span><input aria-label={`Participante ${index + 1}`} value={name} onChange={(event) => setDraftNames((current) => current.map((item, i) => i === index ? event.target.value : item))} placeholder="Escribe un nombre" maxLength={50} />{draftNames.length > 3 && <button type="button" onClick={() => setDraftNames((current) => current.filter((_, i) => i !== index))} aria-label="Eliminar participante">×</button>}</div>)}</div><button className="text-button" type="button" onClick={() => setDraftNames((current) => [...current, ''])}><span>＋</span> Agregar otra persona</button><button className="primary-button" type="submit" disabled={busy}>{busy ? 'Guardando…' : editingId ? 'Actualizar intercambio' : 'Crear intercambio'} <Sparkle /></button>{editingId && <button type="button" className="text-button" onClick={() => { setEditingId(null); setDraftNames(['', '', '', '']); setTitle('Intercambio navideño'); }}>Cancelar edición</button>}</form>
      <div className="admin-list"><h2>Intercambios creados</h2>{exchanges.length === 0 ? <p className="admin-empty">Aún no has creado ninguno.</p> : exchanges.map((item) => <article className="admin-exchange" key={item.id}><div><strong>{item.title}</strong><small>{item.revealed.length} de {item.names.length} resultados revelados</small></div><div className="admin-actions"><button type="button" className="secondary-button" onClick={() => void copyLink(item)}>Copiar enlace</button><button type="button" className="text-button" onClick={() => editExchange(item)}>Editar nombres</button></div></article>)}</div>
    </>}
    {error && <p className="form-error" role="alert">{error}</p>}{notice && <p className="form-notice">{notice}</p>}<a className="admin-back" href="/">Volver al inicio</a>
  </section></main>;

  if (loading) return <main className="app-shell setup-shell"><section className="setup-card"><p className="eyebrow">Noche de regalos</p><h1>Cargando…</h1></section></main>;
  if (!exchange) return <main className="app-shell setup-shell"><section className="setup-card"><div className="mini-mark"><Sparkle /></div><p className="eyebrow">Noche de regalos</p><h1>{token ? 'Enlace no disponible' : '¡Hola, admin!'}</h1><p className="setup-copy">{token ? error || 'No encontramos este intercambio.' : 'Pídele al administrador el enlace de tu intercambio.'}</p><a className="admin-back" href="/admin">Administrar intercambio</a></section></main>;

  return <main className="app-shell"><div className="ambient ambient-one" /><div className="ambient ambient-two" /><div className="snow snow-a">✦</div><div className="snow snow-b">·</div><div className="snow snow-c">✦</div>
    <header><a className="brand" href="/"><span><Sparkle /></span><span>Noche de regalos</span></a><span className="public-title">{exchange.title}</span></header>
    <section className="hero"><div className="ornament" aria-hidden="true"><div className="ornament-line" /><div className="ornament-bow">⌁</div><div className="ornament-ball"><Sparkle /></div></div>
      <p className="eyebrow"><span /> Intercambio navideño <span /></p><h1>Un regalo.<br /><em>Un secreto.</em></h1><p className="subtitle">Elige tu nombre y descubre a quién harás feliz esta Navidad.</p>
      {!completed ? <div className="draw-card"><div className="step-label"><span>01</span><p>Primero, dinos quién eres</p></div><div className="select-wrap"><select value={selectedName} onChange={(event) => setSelectedName(event.target.value)} disabled={isSpinning || !!result}><option value="">Selecciona tu nombre</option>{availableNames.map((name) => <option key={name} value={name}>{name}</option>)}</select><ArrowDown /></div><div className="divider"><Sparkle /></div><div className="step-label"><span>02</span><p>Deja que la magia decida</p></div><button className="spin-button" type="button" disabled={!selectedName || isSpinning || !!result} onClick={() => void spin()}><span className={isSpinning ? 'spinning-star' : ''}><Sparkle /></span>{isSpinning ? 'Girando…' : 'Girar la ruleta'}</button><p className="privacy"><span>◇</span> Tu resultado es secreto. No se mostrará de nuevo.</p>{error && <p className="form-error" role="alert">{error}</p>}</div> : <div className="complete-card"><span className="complete-icon"><Sparkle /></span><p className="eyebrow">La magia está lista</p><h2>¡Todos tienen a alguien!</h2><p>El intercambio está completo. Ahora solo queda encontrar el regalo perfecto.</p></div>}
      <div className="progress"><div><span style={{ width: `${exchange.names.length ? (exchange.revealed.length / exchange.names.length) * 100 : 0}%` }} /></div><p>{exchange.revealed.length} de {exchange.names.length} personas ya descubrieron su nombre</p></div>
    </section><footer>Hecho para compartir un poquito de magia</footer>
    {(isSpinning || result) && <div className="result-overlay" role="dialog" aria-modal="true" aria-label={result ? 'Tu persona secreta' : 'Ruleta girando'}><div className={`result-card ${result ? 'is-revealed' : ''}`}><p className="eyebrow">{result ? 'Tu persona secreta es' : 'La magia está eligiendo…'}</p><div className="result-name">{rouletteName}</div>{result && <><p className="result-copy">Prepara algo especial para <strong>{result}</strong>. Recuerda guardar el secreto.</p><button className="primary-button" type="button" onClick={closeResult}>Lo guardaré en secreto</button></>}</div></div>}
  </main>;
}
