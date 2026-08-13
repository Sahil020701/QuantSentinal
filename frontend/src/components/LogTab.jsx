import React, { useState } from 'react';

export default function LogTab({ logs = [] }) {
  const [selectedSentiment, setSelectedSentiment] = useState('ALL');

  const filteredLogs = selectedSentiment === 'ALL' 
    ? logs 
    : logs.filter(log => log.sentiment === selectedSentiment);

  const sentiments = ['ALL', 'BULLISH', 'BEARISH', 'VOLATILE', 'NEUTRAL'];

  return (
    <div className="tab-content">
      <div className="glass-panel" style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
        <div className="panel-header" style={{ flexWrap: 'wrap', gap: '1rem' }}>
          <div>
            <h2>📝 Quant Sentinal Trading Log</h2>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '0.25rem' }}>
              Daily commentary, quantitative scans, and trade decision narratives
            </p>
          </div>
          
          {/* Filter Pills */}
          <div style={{ display: 'flex', gap: '0.35rem', overflowX: 'auto', paddingBottom: '0.25rem' }}>
            {sentiments.map((sent) => (
              <button
                key={sent}
                onClick={() => setSelectedSentiment(sent)}
                className="tab-btn"
                style={{
                  padding: '0.4rem 0.8rem',
                  fontSize: '0.75rem',
                  borderRadius: '6px',
                  background: selectedSentiment === sent ? 'var(--accent-glow)' : 'transparent',
                  color: selectedSentiment === sent ? 'var(--accent)' : 'var(--text-secondary)',
                  border: selectedSentiment === sent ? '1px solid var(--accent-border)' : '1px solid transparent'
                }}
              >
                {sent}
              </button>
            ))}
          </div>
        </div>

        {filteredLogs.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '4rem 1rem', color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
            No log entries match the selected filter.
          </div>
        ) : (
          <div className="logs-layout">
            {filteredLogs.map((log, idx) => (
              <div className="log-entry" key={idx}>
                <div className="log-header">
                  <span className="log-date">📅 {log.date}</span>
                  <span className={`sentiment-tag ${log.sentiment}`}>
                    {log.sentiment}
                  </span>
                </div>
                <div className="log-text">
                  {log.text}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
