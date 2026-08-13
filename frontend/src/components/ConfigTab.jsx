import React, { useState } from 'react';

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

  const handleSaveConfig = async (e) => {
    e.preventDefault();
    setSaving(true);
    setMessage('');
    try {
      const res = await fetch('http://localhost:5001/api/config', {
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
      setMessage("✅ Configuration saved successfully.");
    } catch (err) {
      console.error(err);
      setMessage("❌ Error: Could not save configuration.");
    } finally {
      setSaving(false);
    }
  };

  const handleDepositSubmit = async (e) => {
    e.preventDefault();
    if (!depositAmount || isNaN(depositAmount) || Number(depositAmount) <= 0) {
      setMessage("❌ Error: Please enter a valid deposit amount.");
      return;
    }
    setDepositing(true);
    setMessage('');
    try {
      const res = await fetch('http://localhost:5001/api/deposit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: Number(depositAmount) })
      });
      if (!res.ok) throw new Error("Deposit failed");
      const data = await res.json();
      onDeposit(data.state);
      setDepositAmount('');
      setMessage(`✅ Successfully injected ₹${Number(depositAmount).toLocaleString('en-IN')} cash into account!`);
    } catch (err) {
      console.error(err);
      setMessage("❌ Error: Capital injection failed.");
    } finally {
      setDepositing(false);
    }
  };

  const handleTriggerRun = async () => {
    setRunning(true);
    setMessage('');
    try {
      const res = await fetch('http://localhost:5001/api/trigger-run', { method: 'POST' });
      if (!res.ok) throw new Error("Trigger run failed");
      const data = await res.json();
      onTriggerRun(data.state);
      setMessage("✅ Daily run catch-up completed.");
    } catch (err) {
      console.error(err);
      setMessage("❌ Error: Daily simulation run failed.");
    } finally {
      setRunning(false);
    }
  };

  const handleReset = async () => {
    if (!window.confirm("Are you sure you want to reset the simulation? All trade history and logs will be wiped, returning account cash to initial ₹20,000 on August 8, 2026.")) return;
    setResetting(true);
    setMessage('');
    try {
      const res = await fetch('http://localhost:5001/api/reset', { method: 'POST' });
      if (!res.ok) throw new Error("Reset failed");
      const data = await res.json();
      onReset(data.state);
      setMessage("✅ Simulation successfully reset to August 8, 2026.");
    } catch (err) {
      console.error(err);
      setMessage("❌ Error: Could not reset simulation.");
    } finally {
      setResetting(false);
    }
  };

  return (
    <div className="tab-content" style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      
      {/* Alert Messages banner */}
      {message && (
        <div style={{
          padding: '1rem',
          borderRadius: '10px',
          background: message.startsWith('✅') ? 'var(--green-glow)' : 'var(--red-glow)',
          border: `1px solid ${message.startsWith('✅') ? 'var(--green-border)' : 'var(--red-border)'}`,
          color: message.startsWith('✅') ? 'var(--green)' : 'var(--red)',
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
            <h2>⚙️ Trading Parameters</h2>
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
              {saving ? "Saving Configurations..." : "💾 Save Strategy Settings"}
            </button>
          </form>
        </div>

        {/* Administration and Controls */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          
          {/* Capital Injection */}
          <div className="glass-panel">
            <div className="panel-header">
              <h2>💰 Capital Injection</h2>
            </div>
            <form onSubmit={handleDepositSubmit} className="config-group">
              <div className="config-item">
                <label>Deposit Amount (₹)</label>
                <div className="config-input-row">
                  <input 
                    type="number" 
                    placeholder="e.g. 20000" 
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
              <h2>🛠️ Simulation Commands</h2>
            </div>
            <div className="config-group">
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                <button 
                  onClick={handleTriggerRun} 
                  className="btn btn-primary" 
                  style={{ width: '100%' }}
                  disabled={running}
                >
                  ⚡ {running ? "Simulating Market Days..." : "Trigger Daily Update"}
                </button>
                <div className="config-desc" style={{ marginBottom: '0.5rem' }}>
                  Force simulation engine to catch up and execute trades up to today's date using actual daily market bars.
                </div>

                <button 
                  onClick={handleReset} 
                  className="btn btn-danger" 
                  style={{ width: '100%' }}
                  disabled={resetting}
                >
                  ⚠️ {resetting ? "Resetting Simulation..." : "Reset Simulation Database"}
                </button>
                <div className="config-desc">
                  Wipes history, closes active positions, and resets cash back to initial ₹20,000 starting on August 8, 2026.
                </div>
              </div>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
