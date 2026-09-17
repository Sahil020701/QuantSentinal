import React, { useState } from 'react';

const fmt = (n) => n?.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) ?? '—';
const fmtPct = (n) => n !== undefined && n !== null ? `${n >= 0 ? '+' : ''}${n.toFixed(2)}%` : '—';

const SENTIMENT_META = {
  BULLISH:  { color: 'var(--green)',          bg: 'rgba(22,163,74,0.08)',   border: 'rgba(22,163,74,0.2)',  dot: '#16a34a' },
  BEARISH:  { color: 'var(--red)',             bg: 'rgba(220,38,38,0.08)',   border: 'rgba(220,38,38,0.2)', dot: '#dc2626' },
  VOLATILE: { color: 'var(--amber)',           bg: 'rgba(202,138,4,0.08)',   border: 'rgba(202,138,4,0.2)', dot: '#ca8a04' },
  NEUTRAL:  { color: 'var(--text-secondary)', bg: 'rgba(71,85,105,0.06)',   border: 'rgba(71,85,105,0.15)',dot: '#64748b' },
};

function TxBadge({ type }) {
  const map = {
    BUY:     { bg: 'rgba(22,163,74,0.12)',  color: 'var(--green)',  label: 'BUY' },
    SELL:    { bg: 'rgba(220,38,38,0.12)',  color: 'var(--red)',    label: 'SELL' },
    DEPOSIT: { bg: 'rgba(37,99,235,0.12)', color: 'var(--accent)', label: 'DEP' },
  };
  const s = map[type] || map.BUY;
  return (
    <span style={{ fontSize: '0.65rem', fontWeight: 800, padding: '0.12rem 0.4rem', borderRadius: '3px', background: s.bg, color: s.color, letterSpacing: '0.05em' }}>
      {s.label}
    </span>
  );
}

function DetailDrawer({ details, date }) {
  if (!details) return (
    <div style={{ padding: '1rem', color: 'var(--text-secondary)', fontSize: '0.8rem' }}>
      No detailed data for this entry (pre-update log).
    </div>
  );
  const txns = details.transactions || [];

  return (
    <div style={{ padding: '0 1rem 1rem 1rem', display: 'flex', flexDirection: 'column', gap: '1rem',
                  borderTop: '1px solid var(--border-color)', paddingTop: '1rem', marginTop: '0.25rem' }}>

      {/* Portfolio Snapshot */}
      <div>
        <div style={{ fontSize: '0.68rem', fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.07em', textTransform: 'uppercase', marginBottom: '0.45rem' }}>
          Portfolio Snapshot — {date}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.5rem' }}>
          {[
            { label: 'Total Value', val: `\u20b9${fmt(details.totalValue)}` },
            { label: 'Cash',        val: `\u20b9${fmt(details.cash)}`,          sub: details.totalValue > 0 ? `${((details.cash / details.totalValue) * 100).toFixed(0)}% liquid` : '' },
            { label: 'Invested',    val: `\u20b9${fmt(details.holdingsValue)}`, sub: `${details.activePositions || 0} positions` },
          ].map(({ label, val, sub }) => (
            <div key={label} style={{ background: 'var(--bg-main)', borderRadius: '8px', padding: '0.55rem 0.7rem', border: '1px solid var(--border-color)' }}>
              <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginBottom: '0.15rem' }}>{label}</div>
              <div style={{ fontSize: '0.87rem', fontWeight: 700, color: 'var(--text-primary)' }}>{val}</div>
              {sub && <div style={{ fontSize: '0.63rem', color: 'var(--text-secondary)', marginTop: '0.1rem' }}>{sub}</div>}
            </div>
          ))}
        </div>
      </div>

      {/* Transactions */}
      {txns.length > 0 && (
        <div>
          <div style={{ fontSize: '0.68rem', fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.07em', textTransform: 'uppercase', marginBottom: '0.45rem' }}>
            Transactions ({txns.length})
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
            {txns.map((t, i) => (
              <div key={i} style={{
                display: 'grid', gridTemplateColumns: '48px 70px 1fr auto', alignItems: 'center',
                gap: '0.5rem', padding: '0.5rem 0.7rem', background: 'var(--bg-main)',
                borderRadius: '7px', border: '1px solid var(--border-color)', fontSize: '0.78rem'
              }}>
                <TxBadge type={t.type} />
                <span style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{t.symbol || '—'}</span>
                <span style={{ color: 'var(--text-secondary)', fontSize: '0.73rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {t.type === 'DEPOSIT'
                    ? `Monthly contribution \u20b9${fmt(t.amount)}`
                    : t.type === 'BUY'
                    ? `${t.quantity} sh @ \u20b9${t.price?.toFixed(2)} | Target \u20b9${t.targetPrice?.toFixed(2)} | SL \u20b9${t.stopLoss?.toFixed(2)}`
                    : `${t.quantity} sh @ \u20b9${t.price?.toFixed(2)} — ${t.reason}`}
                </span>
                {t.type === 'SELL' && (
                  <span style={{ fontWeight: 700, fontSize: '0.75rem', whiteSpace: 'nowrap', color: (t.profit ?? 0) >= 0 ? 'var(--green)' : 'var(--red)' }}>
                    {(t.profit ?? 0) >= 0 ? '+' : ''}\u20b9{Math.abs(t.profit ?? 0).toFixed(0)} ({fmtPct(t.profitPercent)})
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Holdings at EOD */}
      {details.holdings?.length > 0 && (
        <div>
          <div style={{ fontSize: '0.68rem', fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.07em', textTransform: 'uppercase', marginBottom: '0.45rem' }}>
            Holdings at Close ({details.holdings.length})
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(148px, 1fr))', gap: '0.35rem' }}>
            {details.holdings.map((h, i) => (
              <div key={i} style={{
                padding: '0.45rem 0.6rem', background: 'var(--bg-main)', borderRadius: '7px',
                border: `1px solid ${(h.profitPercent ?? 0) >= 0 ? 'rgba(22,163,74,0.2)' : 'rgba(220,38,38,0.2)'}`
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontWeight: 700, fontSize: '0.78rem', color: 'var(--text-primary)' }}>{h.symbol}</span>
                  <span style={{ fontSize: '0.7rem', fontWeight: 700, color: (h.profitPercent ?? 0) >= 0 ? 'var(--green)' : 'var(--red)' }}>
                    {fmtPct(h.profitPercent)}
                  </span>
                </div>
                <div style={{ fontSize: '0.65rem', color: 'var(--text-secondary)', marginTop: '0.1rem' }}>
                  {h.quantity} sh \u00b7 \u20b9{h.currentPrice?.toFixed(1)} \u00b7 \u20b9{fmt(h.value)}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function LogEntry({ log }) {
  const [open, setOpen] = useState(false);
  const meta = SENTIMENT_META[log.sentiment] || SENTIMENT_META.NEUTRAL;
  const details = log.details;

  const buys    = details?.transactions?.filter(t => t.type === 'BUY').length  ?? 0;
  const sells   = details?.transactions?.filter(t => t.type === 'SELL').length ?? 0;
  const deposit = details?.transactions?.some(t => t.type === 'DEPOSIT');
  const firstLine = (log.text || '').split('\n')[0].replace(/\*\*/g, '').slice(0, 130);

  return (
    <div style={{
      background: 'var(--bg-card)', borderRadius: '9px', overflow: 'hidden', transition: 'all 0.18s ease',
      border: `1px solid ${open ? meta.border : 'var(--border-color)'}`,
      borderLeft: `3px solid ${meta.dot}`,
    }}>
      {/* Compact row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', padding: '0.65rem 0.85rem' }}>
        {/* Date */}
        <div style={{ minWidth: '82px', flexShrink: 0 }}>
          <div style={{ fontSize: '0.76rem', fontWeight: 700, color: 'var(--text-primary)' }}>{log.date}</div>
          <div style={{ fontSize: '0.62rem', color: 'var(--text-muted)' }}>
            {new Date(log.date + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'short' })}
          </div>
        </div>
        {/* Sentiment badge */}
        <span style={{ fontSize: '0.62rem', fontWeight: 800, padding: '0.18rem 0.5rem', borderRadius: '4px',
                       background: meta.bg, color: meta.color, letterSpacing: '0.05em', whiteSpace: 'nowrap', flexShrink: 0 }}>
          {log.sentiment}
        </span>
        {/* Activity pills */}
        <div style={{ display: 'flex', gap: '0.3rem', flexShrink: 0 }}>
          {buys > 0  && <span style={{ fontSize: '0.62rem', fontWeight: 700, padding: '0.12rem 0.4rem', borderRadius: '3px', background: 'rgba(22,163,74,0.1)',  color: 'var(--green)' }}>{buys}B</span>}
          {sells > 0 && <span style={{ fontSize: '0.62rem', fontWeight: 700, padding: '0.12rem 0.4rem', borderRadius: '3px', background: 'rgba(220,38,38,0.1)', color: 'var(--red)'   }}>{sells}S</span>}
          {deposit   && <span style={{ fontSize: '0.62rem', fontWeight: 700, padding: '0.12rem 0.4rem', borderRadius: '3px', background: 'rgba(37,99,235,0.1)',  color: 'var(--accent)'}}>DEP</span>}
          {buys === 0 && sells === 0 && !deposit && <span style={{ fontSize: '0.62rem', padding: '0.12rem 0.4rem', borderRadius: '3px', background: 'rgba(71,85,105,0.07)', color: 'var(--text-muted)' }}>—</span>}
        </div>
        {/* Summary text */}
        <div style={{ flex: 1, fontSize: '0.77rem', color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>
          {firstLine}
        </div>
        {/* EOD value */}
        {details?.totalValue != null && (
          <div style={{ textAlign: 'right', flexShrink: 0 }}>
            <div style={{ fontSize: '0.76rem', fontWeight: 700, color: 'var(--text-primary)' }}>\u20b9{fmt(details.totalValue)}</div>
            <div style={{ fontSize: '0.61rem', color: 'var(--text-muted)' }}>{details.activePositions ?? 0} pos</div>
          </div>
        )}
        {/* i button */}
        <button
          onClick={() => setOpen(o => !o)}
          title={open ? 'Collapse' : 'Show detailed breakdown'}
          style={{
            width: '24px', height: '24px', borderRadius: '50%', flexShrink: 0, cursor: 'pointer',
            border: `1px solid ${open ? meta.border : 'var(--border-color)'}`,
            background: open ? meta.bg : 'transparent',
            color: open ? meta.color : 'var(--text-muted)',
            fontWeight: 800, fontSize: '0.72rem',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            transition: 'all 0.15s ease',
          }}
        >
          {open ? '\u00d7' : 'i'}
        </button>
      </div>
      {/* Detail drawer */}
      {open && <DetailDrawer details={details} date={log.date} />}
    </div>
  );
}

export default function LogTab({ logs = [] }) {
  const [selectedSentiment, setSelectedSentiment] = useState('ALL');
  const [searchDate, setSearchDate] = useState('');
  const sentiments = ['ALL', 'BULLISH', 'BEARISH', 'VOLATILE', 'NEUTRAL'];

  const filteredLogs = logs
    .filter(log => selectedSentiment === 'ALL' || log.sentiment === selectedSentiment)
    .filter(log => !searchDate.trim() || log.date.includes(searchDate.trim()));

  const totalBuys  = logs.reduce((s, l) => s + (l.details?.transactions?.filter(t => t.type === 'BUY').length  ?? 0), 0);
  const totalSells = logs.reduce((s, l) => s + (l.details?.transactions?.filter(t => t.type === 'SELL').length ?? 0), 0);

  return (
    <div className="tab-content">
      <div className="glass-panel" style={{ display: 'flex', flexDirection: 'column', gap: '1.1rem' }}>
        {/* Header */}
        <div className="panel-header" style={{ flexWrap: 'wrap', gap: '0.75rem' }}>
          <div>
            <h2>Quant Sentinal Trading Log</h2>
            <p style={{ fontSize: '0.76rem', color: 'var(--text-secondary)', marginTop: '0.2rem' }}>
              {logs.length} trading days &nbsp;&middot;&nbsp; {totalBuys} buys &nbsp;&middot;&nbsp; {totalSells} sells &nbsp;&middot;&nbsp; tap <strong>i</strong> for full daily breakdown
            </p>
          </div>
          <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', flexWrap: 'wrap' }}>
            {sentiments.map(sent => (
              <button
                key={sent}
                onClick={() => setSelectedSentiment(sent)}
                style={{
                  padding: '0.3rem 0.65rem', fontSize: '0.7rem', fontWeight: 600, borderRadius: '6px', cursor: 'pointer',
                  background: selectedSentiment === sent ? (SENTIMENT_META[sent]?.bg || 'var(--accent-glow)') : 'transparent',
                  color:      selectedSentiment === sent ? (SENTIMENT_META[sent]?.color || 'var(--accent)') : 'var(--text-secondary)',
                  border:     selectedSentiment === sent ? `1px solid ${SENTIMENT_META[sent]?.border || 'var(--accent-border)'}` : '1px solid var(--border-color)',
                  transition: 'all 0.15s ease',
                }}
              >
                {sent}
              </button>
            ))}
            <input
              type="text"
              placeholder="Filter date… e.g. 2026-08"
              value={searchDate}
              onChange={e => setSearchDate(e.target.value)}
              style={{ padding: '0.3rem 0.65rem', fontSize: '0.73rem', borderRadius: '6px', border: '1px solid var(--border-color)', background: 'var(--bg-card)', color: 'var(--text-primary)', outline: 'none', width: '175px' }}
            />
          </div>
        </div>
        {/* Entries */}
        {filteredLogs.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '3.5rem 1rem', color: 'var(--text-secondary)', fontSize: '0.88rem' }}>
            No entries match the selected filter.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', maxHeight: '72vh', overflowY: 'auto', paddingRight: '0.2rem' }}>
            {filteredLogs.map((log, idx) => (
              <LogEntry key={`${log.date}-${idx}`} log={log} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
