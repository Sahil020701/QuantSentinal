import React, { useState, useRef } from 'react';

/**
 * Interactive SVG Line Chart
 * @param {Array} data - Array of data points (numbers or {date, value} objects)
 * @param {string} valueKey - Key for value in object, if data is array of objects
 * @param {string} dateKey - Key for date in object, if data is array of objects
 * @param {boolean} showPoints - Highlight points with circles
 * @param {boolean} showTooltip - Show tooltip on hover
 * @param {string} strokeColor - Hex/CSS color for the line
 * @param {string} fillGradId - ID of gradient to use
 * @param {string} valuePrefix - Symbol prefix (e.g. ₹)
 */
export default function MiniChart({
  data = [],
  valueKey = 'value',
  dateKey = 'date',
  showPoints = true,
  showTooltip = true,
  strokeColor = '#00f0ff',
  fillGradId = 'chartGrad',
  valuePrefix = '₹'
}) {
  const [hoveredIdx, setHoveredIdx] = useState(null);
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });
  const containerRef = useRef(null);

  if (!data || data.length === 0) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%', color: '#64748b', fontSize: '0.85rem' }}>
        No historical price data available
      </div>
    );
  }

  // Extract values and labels
  const values = data.map(item => (typeof item === 'object' ? item[valueKey] : item));
  const dates = data.map(item => (typeof item === 'object' ? item[dateKey] : ''));

  const minVal = Math.min(...values);
  const maxVal = Math.max(...values);
  const valRange = maxVal - minVal || 1;
  const paddingPercent = 0.1; // 10% padding above/below data range
  const adjustedMin = Math.max(0, minVal - valRange * paddingPercent);
  const adjustedMax = maxVal + valRange * paddingPercent;
  const adjustedRange = adjustedMax - adjustedMin;

  // Chart coordinate layout
  const width = 500;
  const height = 240;
  const paddingX = 40;
  const paddingY = 20;
  
  const chartWidth = width - paddingX * 2;
  const chartHeight = height - paddingY * 2;

  // Map values to coordinates
  const points = values.map((val, i) => {
    const x = paddingX + (i / (values.length - 1 || 1)) * chartWidth;
    const y = paddingY + chartHeight - ((val - adjustedMin) / adjustedRange) * chartHeight;
    return { x, y, val, date: dates[i] };
  });

  // Build SVG path
  let pathD = '';
  if (points.length > 0) {
    pathD = `M ${points[0].x} ${points[0].y}`;
    for (let i = 1; i < points.length; i++) {
      // Linear connection
      pathD += ` L ${points[i].x} ${points[i].y}`;
    }
  }

  // Build Area path (for fill gradient underneath the line)
  let areaD = '';
  if (points.length > 0) {
    areaD = `${pathD} L ${points[points.length - 1].x} ${height - paddingY} L ${points[0].x} ${height - paddingY} Z`;
  }

  // Handle Mouse Hover
  const handleMouseMove = (e) => {
    if (!containerRef.current || points.length === 0) return;
    const rect = containerRef.current.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    
    // Scale factor between SVG coordinate system (500x240) and actual DOM element width
    const scaleX = width / rect.width;
    const svgMouseX = mouseX * scaleX;

    // Find closest point by X coordinate
    let closestIdx = 0;
    let minDist = Math.abs(points[0].x - svgMouseX);

    for (let i = 1; i < points.length; i++) {
      const dist = Math.abs(points[i].x - svgMouseX);
      if (dist < minDist) {
        minDist = dist;
        closestIdx = i;
      }
    }

    setHoveredIdx(closestIdx);

    // Position tooltip relative to container (in DOM pixels)
    const activePoint = points[closestIdx];
    const domX = (activePoint.x / width) * rect.width;
    const domY = (activePoint.y / height) * rect.height;

    setTooltipPos({
      x: domX,
      y: domY - 45
    });
  };

  const handleMouseLeave = () => {
    setHoveredIdx(null);
  };

  // Gridlines values
  const yTicks = 4;
  const gridLines = [];
  for (let i = 0; i < yTicks; i++) {
    const ratio = i / (yTicks - 1);
    const yVal = adjustedMin + ratio * adjustedRange;
    const yCoord = paddingY + chartHeight - ratio * chartHeight;
    gridLines.push({ yCoord, yVal });
  }

  return (
    <div 
      className="chart-container" 
      ref={containerRef}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      style={{ position: 'relative', width: '100%', height: '100%' }}
    >
      <svg 
        viewBox={`0 0 ${width} ${height}`} 
        className="chart-svg" 
        style={{ width: '100%', height: '100%', display: 'block' }}
      >
        <defs>
          <linearGradient id={fillGradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" className="chart-gradient-stop-1" />
            <stop offset="100%" className="chart-gradient-stop-2" />
          </linearGradient>
        </defs>

        {/* Horizontal Grid lines */}
        {gridLines.map((line, idx) => (
          <g key={idx}>
            <line 
              x1={paddingX} 
              y1={line.yCoord} 
              x2={width - paddingX} 
              y2={line.yCoord} 
              className="chart-grid-line" 
            />
            {/* Axis labels */}
            <text 
              x={paddingX - 8} 
              y={line.yCoord + 3} 
              textAnchor="end" 
              fill="#64748b" 
              fontSize="9"
              fontWeight="500"
            >
              {valuePrefix}{Math.round(line.yVal).toLocaleString('en-IN')}
            </text>
          </g>
        ))}

        {/* X Axis Date labels (start, mid, end) */}
        {dates.length > 1 && (
          <>
            <text x={paddingX} y={height - 4} textAnchor="start" fill="#64748b" fontSize="9" fontWeight="500">
              {dates[0]}
            </text>
            <text x={width / 2} y={height - 4} textAnchor="middle" fill="#64748b" fontSize="9" fontWeight="500">
              {dates[Math.floor(dates.length / 2)]}
            </text>
            <text x={width - paddingX} y={height - 4} textAnchor="end" fill="#64748b" fontSize="9" fontWeight="500">
              {dates[dates.length - 1]}
            </text>
          </>
        )}

        {/* Fill Area */}
        {areaD && (
          <path d={areaD} fill={`url(#${fillGradId})`} />
        )}

        {/* Sparkline path */}
        {pathD && (
          <path 
            d={pathD} 
            className="chart-line" 
            stroke={strokeColor} 
          />
        )}

        {/* Highlight points on hover */}
        {showPoints && points.map((p, idx) => (
          <circle
            key={idx}
            cx={p.x}
            cy={p.y}
            r={hoveredIdx === idx ? 6 : (points.length < 30 ? 2.5 : 0)}
            className="chart-point"
            style={{ 
              fill: hoveredIdx === idx ? strokeColor : 'var(--bg-main)',
              stroke: strokeColor,
              strokeWidth: 2
            }}
          />
        ))}

        {/* Active Hover vertical guide line */}
        {hoveredIdx !== null && (
          <line
            x1={points[hoveredIdx].x}
            y1={paddingY}
            x2={points[hoveredIdx].x}
            y2={height - paddingY}
            stroke="var(--border-color)"
            strokeDasharray="4 4"
            strokeWidth="1.5"
          />
        )}
      </svg>

      {/* Floating HTML Tooltip */}
      {showTooltip && hoveredIdx !== null && (
        <div 
          className="chart-tooltip"
          style={{
            left: `${tooltipPos.x}px`,
            top: `${tooltipPos.y}px`,
            transform: 'translateX(-50%)',
          }}
        >
          <span className="chart-tooltip-date">{points[hoveredIdx].date}</span>
          <span className="chart-tooltip-val">
            {valuePrefix}{points[hoveredIdx].val.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </span>
        </div>
      )}
    </div>
  );
}
