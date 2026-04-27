import React from 'react';

const IndiaMap = ({ data, onRegionClick, activeRegion }) => {
  // Simplified SVG paths for major clusters
  // Note: These are representative paths for a clean dashboard look
  const regions = [
    { id: 'North', name: 'North India', path: 'M 150 50 L 250 50 L 280 150 L 120 150 Z', color: '#ff6b6b' },
    { id: 'West', name: 'West India', path: 'M 120 150 L 200 150 L 180 250 L 80 220 Z', color: '#4ecdc4' },
    { id: 'JOBC', name: 'JOBC Cluster', path: 'M 280 150 L 350 160 L 330 260 L 250 240 Z', color: '#ffe66d' },
    { id: 'RAPT', name: 'RAPT Cluster', path: 'M 200 150 L 280 150 L 250 240 L 180 250 Z', color: '#1a535c' },
    { id: 'KAR', name: 'Karnataka', path: 'M 180 250 L 230 250 L 210 320 L 160 300 Z', color: '#f7fff7' },
    { id: 'TN', name: 'Tamil Nadu', path: 'M 230 250 L 280 260 L 250 350 L 210 320 Z', color: '#ff6b6b' },
  ];

  // Calculate counts per cluster
  const counts = data.reduce((acc, curr) => {
    acc[curr.cluster] = (acc[curr.cluster] || 0) + 1;
    return acc;
  }, {});

  return (
    <div className="map-container" style={{ position: 'relative', width: '100%', height: '400px', display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
      <svg viewBox="0 0 400 400" style={{ width: '100%', height: '100%', filter: 'drop-shadow(0 0 10px rgba(0,0,0,0.3))' }}>
        {regions.map((region) => {
          const count = counts[region.id] || 0;
          const isActive = activeRegion === region.id;
          const opacity = count > 0 ? 0.3 + (count / data.length) * 0.7 : 0.1;
          
          return (
            <path
              key={region.id}
              d={region.path}
              fill={isActive ? 'var(--accent-glow)' : 'var(--accent-brand)'}
              fillOpacity={opacity}
              stroke="white"
              strokeWidth={isActive ? 2 : 1}
              style={{ cursor: 'pointer', transition: 'all 0.3s ease' }}
              onClick={() => onRegionClick(region.id)}
            >
              <title>{`${region.name}: ${count} Auditors`}</title>
            </path>
          );
        })}
        
        {/* Simple Labels */}
        <text x="180" y="100" fill="white" fontSize="12" pointerEvents="none">NORTH</text>
        <text x="110" y="200" fill="white" fontSize="12" pointerEvents="none">WEST</text>
        <text x="300" y="210" fill="white" fontSize="12" pointerEvents="none">JOBC</text>
        <text x="210" y="200" fill="white" fontSize="12" pointerEvents="none">RAPT</text>
        <text x="170" y="280" fill="white" fontSize="12" pointerEvents="none">KAR</text>
        <text x="240" y="310" fill="white" fontSize="12" pointerEvents="none">TN</text>
      </svg>
    </div>
  );
};

export default IndiaMap;
