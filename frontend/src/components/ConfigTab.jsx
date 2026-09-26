import React, { useState } from 'react';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5001';

export default function ConfigTab({ portfolio, onConfigUpdate, onReset, onDeposit, onTriggerRun }) {
  const { config } = portfolio;

  // Local state for configuration adjustments
  const [targetProfit, setTargetProfit] = useState(config.targetProfitPercent * 100);
  const [stopLoss, setStopLoss] = useState(config.stopLossPercent * 100);
  const [maxPositions, setMaxPositions] = useState(config.maxPositions);
  const [aggressiveness, setAggressiveness] = useState(config.aggressiveness);

  // Local state for manual deposit
  const [depositAmount, setDepositAmount] = useState('');
  
  // Action status indicators
  const [saving, setSaving] = useState(false);
  const [depositing, setDepositing] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState('');

  // Simulation start date selection state
  const getTodayStr = () => {
    const d = new Date();
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  const todayStr = getTodayStr();
  const [selectedStartDate, setSelectedStartDate] = useState('2023-09-01');
  const [autoReplay, setAutoReplay] = useState(true);

  const getPastDateStr = (yearsAgo) => {
    const d = new Date();
    d.setFullYear(d.getFullYear() - yearsAgo);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  const datePresets = [
    { label: '3Y Ago (Full Cycle)', value: getPastDateStr(3) },
    { label: '2Y Ago', value: getPastDateStr(2) },
    { label: '1Y Ago', value: getPastDateStr(1) },
    { label: '6M Ago', value: getPastDateStr(0.5 ? 0 : 0) === todayStr ? '2026-03-26' : '2026-03-26' },
    { label: 'Today (Clean Slate)', value: todayStr }
  ];

  const handleSaveConfig = async (e) => {
    e.preventDefault();
    setSaving(true);
    setMessage('');
    try {
      const res = await fetch(`${API_URL}/api/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetProfitPercent: targetProfit / 100,
          stopLossPercent: stopLoss / 100,
          maxPositions: Number(maxPositions),
          aggressiveness
        })
      });
      if (!res.ok) throw new Error("Failed to save settings");
      const data = await res.json();
      onConfigUpdate(data.config);
      setMessage("Configuration saved successfully.");
    } catch (err) {
      console.error(err);
      setMessage("Error: Could not save configuration.");
    } finally {
      setSaving(false);
    }
  };

  const handleDepositSubmit = async (e) => {
    e.preventDefault();
    if (!depositAmount || isNaN(depositAmount) || Number(depositAmount) <= 0) {
      setMessage("Error: Please enter a valid deposit amount.");
      return;
    }
    setDepositing(true);
    setMessage('');
    try {
      const res = await fetch(`${API_URL}/api/deposit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: Number(depositAmount) })
      });
      if (!res.ok) throw new Error("Deposit failed");
      const data = await res.json();
      onDeposit(data.state);
      setDepositAmount('');
      setMessage(`Successfully injected ₹${Number(depositAmount).toLocaleString('en-IN')} cash into account!`);
    } catch (err) {
      console.error(err);
      setMessage("Error: Capital injection failed.");
    } finally {
      setDepositing(false);
    }
  };

  const handleTriggerRun = async () => {
    setRunning(true);
    setMessage('');
    try {
      const res = await fetch(`${API_URL}/api/trigger-run`, { method: 'POST' });
      if (!res.ok) throw new Error("Trigger run failed");
      const data = await res.json();
      onTriggerRun(data.state);
      setMessage("Daily run catch-up completed.");
    } catch (err) {
      console.error(err);
      setMessage("Error: Daily simulation run failed.");
    } finally {
      setRunning(false);
    }
  };

  const handleResetCustomDate = async (targetDate = selectedStartDate, replay = autoReplay) => {
    const isToday = targetDate === 'today' || targetDate === todayStr;
    const confirmMessage = isToday
      ? `Are you sure you want to reset the simulation starting TODAY (${todayStr})?\n\nAll current trade history, active holdings, and logs will be wiped. The account will start fresh today with initial ₹1,00,000 cash.`
      : `Are you sure you want to reset the simulation to start on ${targetDate}?\n\nAll current trade history, active holdings, and logs will be wiped, returning account cash to initial ₹1,00,000 on ${targetDate}.${replay ? '\n\nThe engine will automatically replay all trading days up to today.' : ''}`;

    if (!window.confirm(confirmMessage)) return;

    setResetting(true);
    setMessage('');
    try {
      const res = await fetch(`${API_URL}/api/reset`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          startDate: targetDate,
          replay: isToday ? false : replay
        })
      });
      if (!res.ok) throw new Error("Reset failed");
      const data = await res.json();
      onReset(data.state);
      setMessage(
        isToday
          ? `Simulation successfully reset to Today (${todayStr}) with clean ₹50,000 slate.`
          : `Simulation successfully reset to ${targetDate}${replay ? ' and backtest replayed to today.' : '.'}`
      );
    } catch (err) {
      console.error(err);
      setMessage("Error: Could not reset simulation.");
    } finally {
      setResetting(false);
    }
  };

  const isErrorMessage = message.toLowerCase().includes('error');

  return (
    <div className="tab-content" style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      
      {/* Alert Messages banner */}
      {message && (
        <div style={{
          padding: '1rem',
          borderRadius: '10px',
          background: isErrorMessage ? 'var(--red-glow)' : 'var(--green-glow)',
          border: `1px solid ${isErrorMessage ? 'var(--red-border)' : 'var(--green-border)'}`,
          color: isErrorMessage ? 'var(--red)' : 'var(--green)',
          fontSize: '0.9rem',
          fontWeight: '500'
        }}>
          {message}
        </div>
      )}

      <div className="config-layout">
        {/* Risk Management Settings */}
        <div className="glass-panel">
          <div className="panel-header">
            <h2>Trading Parameters</h2>
          </div>
          <form onSubmit={handleSaveConfig} className="config-group">
            <div className="config-item">
              <label>Aggressiveness Mode</label>
              <select 
                className="config-select" 
                value={aggressiveness}
                onChange={(e) => setAggressiveness(e.target.value)}
              >
                <option value="conservative">Conservative (Aim: 8-12% annual, tight risk)</option>
                <option value="moderate">Moderate (Aim: 12-15% annual, balanced risk)</option>
                <option value="aggressive">Aggressive (Aim: 15-20% annual, active swings)</option>
                <option value="hyper">Hyper-Aggressive (Aim: 25%+ annual, maximum momentum)</option>
              </select>
              <div className="config-desc">Defines position allocation weights and trade filtering strictness.</div>
            </div>

            <div className="config-item">
              <label>Target Profit Threshold</label>
              <div className="config-slider-row">
                <input 
                  type="range" 
                  min="5" 
                  max="30" 
                  value={targetProfit} 
                  onChange={(e) => setTargetProfit(Number(e.target.value))}
                  className="config-slider"
                />
                <span className="config-slider-val">+{targetProfit}%</span>
              </div>
              <div className="config-desc">Profit target ratio at which open positions automatically trigger limit sells.</div>
            </div>

            <div className="config-item">
              <label>Stop Loss Threshold</label>
              <div className="config-slider-row">
                <input 
                  type="range" 
                  min="2" 
                  max="15" 
                  value={stopLoss} 
                  onChange={(e) => setStopLoss(Number(e.target.value))}
                  className="config-slider"
                />
                <span className="config-slider-val">-{stopLoss}%</span>
              </div>
              <div className="config-desc">Percentage loss threshold at which positions automatically trigger stop loss liquidations.</div>
            </div>

            <div className="config-item">
              <label>Max Concurrent Holdings</label>
              <input 
                type="number" 
                min="2" 
                max="50" 
                value={maxPositions}
                onChange={(e) => setMaxPositions(e.target.value)}
                className="config-input"
              />
              <div className="config-desc">Maximum number of stock positions held in parallel (governs capital scaling per stock).</div>
            </div>

            <button type="submit" className="btn btn-primary" style={{ marginTop: '0.5rem' }} disabled={saving}>
              {saving ? "Saving Configurations..." : "Save Strategy Settings"}
            </button>
          </form>
        </div>

        {/* Administration and Controls */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          
          {/* Capital Injection */}
          <div className="glass-panel">
            <div className="panel-header">
              <h2>Capital Injection</h2>
            </div>
            <form onSubmit={handleDepositSubmit} className="config-group">
              <div className="config-item">
                <label>Deposit Amount (₹)</label>
                <div className="config-input-row">
                  <input 
                    type="number" 
                    placeholder="e.g. 50000" 
                    value={depositAmount}
                    onChange={(e) => setDepositAmount(e.target.value)}
                    className="config-input"
                  />
                  <button type="submit" className="btn btn-primary" disabled={depositing}>
                    {depositing ? "Depositing..." : "Inject Cash"}
                  </button>
                </div>
                <div className="config-desc">Add supplementary funds directly to the trading desk cash reserves.</div>
              </div>
            </form>
          </div>

          {/* Simulation Commands */}
          <div className="glass-panel">
            <div className="panel-header">
              <h2>Simulation Commands</h2>
            </div>
            <div className="config-group">
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                <button 
                  onClick={handleTriggerRun} 
                  className="btn btn-primary" 
                  style={{ width: '100%' }}
                  disabled={running || resetting}
                >
                  {running ? "Simulating Market Days..." : "Trigger Daily Update"}
                </button>
                <div className="config-desc" style={{ marginBottom: '0.5rem' }}>
                  Force simulation engine to catch up and execute trades up to today's date using actual daily market bars.
                </div>

                <div style={{ borderTop: '1px solid var(--border-color)', margin: '0.25rem 0 0.5rem 0' }} />

                {/* Custom Reset & Start Date Selection */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <label style={{ fontSize: '0.9rem', fontWeight: '600', color: 'var(--text-primary)' }}>
                      Reset Simulation & Start Date
                    </label>
                    <span style={{ 
                      fontSize: '0.75rem', 
                      padding: '0.2rem 0.55rem', 
                      borderRadius: '5px',
                      background: selectedStartDate === todayStr ? 'var(--green-glow)' : 'var(--accent-glow)',
                      color: selectedStartDate === todayStr ? 'var(--green)' : 'var(--accent)',
                      border: `1px solid ${selectedStartDate === todayStr ? 'var(--green-border)' : 'var(--accent-border)'}`,
                      fontWeight: '600'
                    }}>
                      {selectedStartDate === todayStr ? 'Live Forward Mode' : 'Historical Backtest'}
                    </span>
                  </div>

                  <div className="config-desc" style={{ marginTop: '-0.25rem' }}>
                    Choose any past date to run a fresh retrospective backtest, or pick today to start trading from a clean slate.
                  </div>

                  {/* Date Input */}
                  <div className="config-item" style={{ marginTop: '0.1rem' }}>
                    <label style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Choose Start Date (YYYY-MM-DD)</label>
                    <input 
                      type="date" 
                      value={selectedStartDate}
                      min="2022-01-01"
                      max={todayStr}
                      onChange={(e) => setSelectedStartDate(e.target.value)}
                      className="config-input"
                      disabled={resetting || running}
                      style={{ cursor: 'pointer' }}
                    />
                  </div>

                  {/* Preset Pills */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Quick Date Presets:</div>
                    <div className="preset-pills">
                      {datePresets.map((preset) => (
                        <button
                          key={preset.value}
                          type="button"
                          className={`preset-pill ${selectedStartDate === preset.value ? 'active' : ''}`}
                          onClick={() => setSelectedStartDate(preset.value)}
                          disabled={resetting || running}
                        >
                          {preset.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Auto-Replay Toggle */}
                  {selectedStartDate !== todayStr && (
                    <label style={{ 
                      display: 'flex', 
                      alignItems: 'center', 
                      gap: '0.55rem', 
                      cursor: 'pointer', 
                      fontSize: '0.825rem',
                      color: 'var(--text-secondary)',
                      marginTop: '0.15rem'
                    }}>
                      <input 
                        type="checkbox" 
                        checked={autoReplay}
                        onChange={(e) => setAutoReplay(e.target.checked)}
                        disabled={resetting || running}
                        style={{ cursor: 'pointer', accentColor: 'var(--accent)' }}
                      />
                      <span>Automatically replay backtest trades from <strong>{selectedStartDate}</strong> to today</span>
                    </label>
                  )}

                  {/* Reset Action Button */}
                  <button 
                    onClick={() => handleResetCustomDate(selectedStartDate, autoReplay)} 
                    className="btn btn-danger" 
                    style={{ width: '100%', marginTop: '0.35rem', fontWeight: '600' }}
                    disabled={resetting || running || !selectedStartDate}
                  >
                    {resetting 
                      ? "Resetting & Replaying Simulation..." 
                      : selectedStartDate === todayStr 
                        ? "Reset to Today (Clean Slate ₹50k)" 
                        : autoReplay 
                          ? `Reset & Run Backtest from ${selectedStartDate}` 
                          : `Reset Baseline to ${selectedStartDate}`
                    }
                  </button>

                  <div className="config-desc" style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                    Wipes all trade history, active holdings, and logs. Reinitializes cash balance to ₹50,000 starting on {selectedStartDate}.
                  </div>
                </div>
              </div>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
