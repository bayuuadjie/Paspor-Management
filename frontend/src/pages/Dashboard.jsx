import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { Empty, PageHead, tgl, useToast, VISABIO, FISIK, PRINT } from '../ui.jsx';

const Bars = ({ title, order, data, total }) => (
  <div className="card"><h3>{title}</h3>
    {order.map(k => { const n = data[k] || 0; return (
      <div className="bar-row" key={k}><span className="cap">{k}</span>
        <div className="bar"><i style={{ width: total ? `${(n / total) * 100}%` : 0 }} /></div><b>{n}</b></div>); })}
  </div>
);

export default function Dashboard() {
  const notify = useToast(); const [s, setS] = useState(null);
  useEffect(() => { api('/stats').then(setS).catch(e => notify(e.message, 'bad')); }, []);
  if (!s) return <p className="muted">Memuat…</p>;
  return (
    <>
      <PageHead title="Ringkasan" sub="Kondisi data paspor jemaah saat ini." />
      <div className="cols">
        <Bars title="Status visabio" order={VISABIO} data={s.visabio} total={s.total} />
        <Bars title="Print visabio" order={PRINT} data={s.print} total={s.total} />
        <Bars title="Paspor fisik" order={FISIK} data={s.fisik} total={s.total} />
      </div>
      <div className="card"><h3>Visabio under review</h3>
        {s.review.length ? <ul className="plain">{s.review.map(p => <li key={p.id}><span><b>{p.name}</b><small className="muted"> {p.passport_number}</small></span>
          <span>{tgl(p.visabio_date)}</span></li>)}</ul>
          : <Empty>Tidak ada visabio yang sedang under review.</Empty>}</div>
    </>
  );
}