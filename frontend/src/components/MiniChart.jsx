import React, { useState, useRef, useEffect } from 'react';

/**
 * Interactive SVG Line Chart — Enhanced
 * @param {Array} data - Array of data points (numbers or {date, value} objects)
 * @param {string} valueKey - Key for value in object, if data is array of objects
 * @param {string} dateKey - Key for date in object, if data is array of objects
 * @param {boolean} showPoints - Highlight points with circles
 * @param {boolean} showTooltip - Show tooltip on hover
 * @param {string} strokeColor - Hex/CSS color for the line (auto-overridden by period performance)
 * @param {string} fillGradId - ID of gradient to use
 * @param {string} valuePrefix - Symbol prefix (e.g. ₹)
 * @param {number} baselineValue - Optional baseline (e.g. deposited capital) for reference line
 * @param {string} baselineLabel - Optional label for the baseline reference line
 */
export default function MiniChart({
  data = [],
  valueKey = 'value',
  dateKey = 'date',
  showPoints = true,
  showTooltip = true,
  strokeColor = '#2563eb',
  fillGradId = 'chartGrad',
  valuePrefix = '₹',
  baselineValue = null,
  baselineLabel = 'Invested Capital',
}) {
  const [hoveredIdx, setHoveredIdx] = useState(null);
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });
  const [animated, setAnimated] = useState(false);
  const containerRef = useRef(null);

  // Trigger line-draw animation whenever data changes
  useEffect(() => {
    setAnimated(false);
    const id = setTimeout(() => setAnimated(true), 30);
    return () => clearTimeout(id);
  }, [data]);

  if (!data || data.length === 0) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%', color: '#94a3b8', fontSize: '0.85rem' }}>
        No historical data for selected period
      </div>
    );
  }

  // Extract values and labels
  const values = data.map(item => (typeof item === 'object' ? item[valueKey] : item));
  const dates  = data.map(item => (typeof item === 'object' ? item[dateKey]  : ''));

  const minVal = Math.min(...values);
  const maxVal = Math.max(...values);
  const valRange = maxVal - minVal || 1;
  const padPct = 0.12;
  const adjustedMin   = minVal >= 0 ? Math.max(0, minVal - valRange * padPct) : minVal - valRange * padPct;
  const adjustedMax   = maxVal + valRange * padPct;
  const adjustedRange = adjustedMax - adjustedMin;

  // SVG canvas dimensions
  const width        = 600;
  const height       = 260;
  const paddingX     = 58;
  const paddingY     = 24;
  const paddingBot   = 34;
  const chartWidth   = width  - paddingX * 2;
  const chartHeight  = height - paddingY - paddingBot;

  // Map data to SVG coordinates
  const points = values.map((val, i) => ({
    x: paddingX + (i / (values.length - 1 || 1)) * chartWidth,
    y: paddingY + chartHeight - ((val - adjustedMin) / adjustedRange) * chartHeight,
    val,
    date: dates[i],
  }));

  // Smooth cubic-bezier path
  const buildBezierPath = (pts) => {
    if (!pts.length) return '';
    if (pts.length === 1) return `M ${pts[0].x} ${pts[0].y}`;
    let d = `M ${pts[0].x} ${pts[0].y}`;
    for (let i = 1; i < pts.length; i++) {
      const cpX = (pts[i - 1].x + pts[i].x) / 2;
      d += ` C ${cpX} ${pts[i - 1].y} ${cpX} ${pts[i].y} ${pts[i].x} ${pts[i].y}`;
    }
    return d;
  };

  const pathD = buildBezierPath(points);
  const areaD = pathD
    ? `${pathD} L ${points[points.length - 1].x} ${height - paddingBot} L ${points[0].x} ${height - paddingBot} Z`
    : '';

  // Color based on period performance
  const isPositive = values[values.length - 1] >= values[0];
  const lineColor  = isPositive ? '#16a34a' : '#dc2626';
  const gradId     = `${fillGradId}_area`;
  const clipId     = `${fillGradId}_clip`;

  // Baseline Y coordinate (e.g. deposited capital reference)
  let baselineY = null;
  if (baselineValue !== null) {
    baselineY = paddingY + chartHeight - ((baselineValue - adjustedMin) / adjustedRange) * chartHeight;
    baselineY = Math.max(paddingY, Math.min(height - paddingBot, baselineY));
  }

  // Mouse handling
  const handleMouseMove = (e) => {
    if (!containerRef.current || !points.length) return;
    const rect = containerRef.current.getBoundingClientRect();
    const svgMouseX = ((e.clientX - rect.left) / rect.width) * width;
    let ci = 0, md = Infinity;
    points.forEach((p, i) => {
      const d = Math.abs(p.x - svgMouseX);
      if (d < md) { md = d; ci = i; }
    });
    setHoveredIdx(ci);
    const ap = points[ci];
    setTooltipPos({
      x: (ap.x / width) * rect.width,
      y: (ap.y / height) * rect.height - 58,
    });
  };
  const handleMouseLeave = () => setHoveredIdx(null);

  // Y-axis grid labels (abbreviated)
  const formatY = (v) => {
    const abs = Math.abs(v);
    const sign = v < 0 ? '-' : '';
    if (abs >= 10000000) return `${sign}${(abs / 10000000).toFixed(1)}Cr`;
    if (abs >= 100000)   return `${sign}${(abs / 100000).toFixed(1)}L`;
    if (abs >= 1000)     return `${sign}${(abs / 1000).toFixed(1)}K`;
    return `${sign}${Math.round(abs)}`;
  };
  const gridLines = Array.from({ length: 5 }, (_, i) => {
    const ratio  = i / 4;
    return {
      yCoord: paddingY + chartHeight - ratio * chartHeight,
      yVal:   adjustedMin + ratio * adjustedRange,
    };
  });

  // X-axis labels (up to 5 spread evenly)
  const xCount  = Math.min(5, dates.length);
  const xLabels = dates.length > 1
    ? Array.from({ length: xCount }, (_, i) => {
        const idx = Math.round((i / (xCount - 1)) * (dates.length - 1));
        return { x: points[idx].x, label: dates[idx], anchor: i === 0 ? 'start' : i === xCount - 1 ? 'end' : 'middle' };
      })
    : [];

  return (
    <div
      className="chart-container"
      ref={containerRef}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      style={{ position: 'relative', width: '100%', height: '100%' }}
    >
      <svg viewBox={`0 0 ${width} ${height}`} className="chart-svg" style={{ width: '100%', height: '100%', display: 'block' }}>
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%"   stopColor={lineColor} stopOpacity="0.2" />
            <stop offset="70%"  stopColor={lineColor} stopOpacity="0.05" />
            <stop offset="100%" stopColor={lineColor} stopOpacity="0" />
          </linearGradient>
          {/* Animated reveal clip */}
          <clipPath id={clipId}>
            <rect
              x={paddingX} y={0}
              width={animated ? chartWidth : 0}
              height={height}
              style={{ transition: animated ? 'width 0.85s cubic-bezier(0.4,0,0.2,1)' : 'none' }}
            />
          </clipPath>
        </defs>

        {/* Horizontal grid lines + Y labels */}
        {gridLines.map((gl, i) => (
          <g key={i}>
            <line
              x1={paddingX} y1={gl.yCoord}
              x2={width - paddingX} y2={gl.yCoord}
              stroke="rgba(15,23,42,0.06)"
              strokeWidth="1"
              strokeDasharray={i === 0 ? '0' : '3 5'}
            />
            <text x={paddingX - 7} y={gl.yCoord + 4} textAnchor="end"
              fill="#94a3b8" fontSize="9" fontWeight="500" fontFamily="inherit">
              {valuePrefix}{formatY(gl.yVal)}
            </text>
          </g>
        ))}

        {/* X-axis date labels */}
        {xLabels.map((xl, i) => (
          <text key={i} x={xl.x} y={height - 10}
            textAnchor={xl.anchor} fill="#94a3b8" fontSize="9" fontWeight="500" fontFamily="inherit">
            {xl.label}
          </text>
        ))}

        {/* X-axis bottom border */}
        <line x1={paddingX} y1={height - paddingBot} x2={width - paddingX} y2={height - paddingBot}
          stroke="rgba(15,23,42,0.07)" strokeWidth="1" />

        {/* Baseline (deposited capital or break-even) reference */}
        {baselineY !== null && (
          <g>
            <line x1={paddingX} y1={baselineY} x2={width - paddingX} y2={baselineY}
              stroke="rgba(100,116,139,0.45)" strokeWidth="1" strokeDasharray="5 4" />
            <text x={paddingX + 4} y={baselineY - 5}
              fill="#94a3b8" fontSize="8.5" fontWeight="600" fontFamily="inherit">{baselineLabel}</text>
          </g>
        )}

        {/* Fill area */}
        {areaD && <path d={areaD} fill={`url(#${gradId})`} clipPath={`url(#${clipId})`} />}

        {/* Chart line */}
        {pathD && (
          <path d={pathD} fill="none"
            stroke={lineColor} strokeWidth="2.5"
            strokeLinecap="round" strokeLinejoin="round"
            style={{ filter: `drop-shadow(0 2px 8px ${lineColor}55)` }}
            clipPath={`url(#${clipId})`}
          />
        )}




        {/* Hover crosshair */}
        {hoveredIdx !== null && (
          <g>
            <line x1={points[hoveredIdx].x} y1={paddingY}
              x2={points[hoveredIdx].x} y2={height - paddingBot}
              stroke="rgba(15,23,42,0.1)" strokeWidth="1.5" strokeDasharray="4 3" />
            <circle cx={points[hoveredIdx].x} cy={points[hoveredIdx].y}
              r="9" fill={lineColor} fillOpacity="0.12" />
            <circle cx={points[hoveredIdx].x} cy={points[hoveredIdx].y}
              r="4.5" fill={lineColor} stroke="white" strokeWidth="2" />
          </g>
        )}
      </svg>

      {/* Tooltip */}
      {showTooltip && hoveredIdx !== null && (() => {
        const pt  = points[hoveredIdx];
        return (
          <div className="chart-tooltip"
            style={{ left: `${tooltipPos.x}px`, top: `${tooltipPos.y}px`, transform: 'translateX(-50%)' }}>
            <span className="chart-tooltip-date">{pt.date}</span>
            <span className="chart-tooltip-val">
              {pt.val < 0 ? '-' : ''}{valuePrefix}{Math.abs(pt.val).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
          </div>
        );
      })()}
    </div>
  );
}
