import React, { useMemo, useState } from 'react';
import {
  ComposableMap,
  Geographies,
  Geography,
  Marker,
} from 'react-simple-maps';
import { MapPin, X, Users, Map as MapIcon, Layers } from 'lucide-react';
import indiaTopo from '../../data/india_topo.json';
import asmTerritory from '../../data/asm_territory.json';

// Monotone chain algorithm for Convex Hull
const getConvexHull = (points) => {
  if (points.length < 3) return points;
  const sorted = [...points].sort((a, b) => a.lng - b.lng || a.lat - b.lat);
  const cross = (o, a, b) => (a.lng - o.lng) * (b.lat - o.lat) - (a.lat - o.lat) * (b.lng - o.lng);
  
  const lower = [];
  for (let i = 0; i < sorted.length; i++) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], sorted[i]) <= 0) lower.pop();
    lower.push(sorted[i]);
  }
  
  const upper = [];
  for (let i = sorted.length - 1; i >= 0; i--) {
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], sorted[i]) <= 0) upper.pop();
    upper.push(sorted[i]);
  }
  
  upper.pop();
  lower.pop();
  return lower.concat(upper);
};

const AsmCoverageMap = ({ data, auditorsMaster }) => {
  const [selectedAsm, setSelectedAsm] = useState(null);

  // Generate distinct colors for different ASMs
  const asmColors = useMemo(() => {
    const colors = ['#58a6ff', '#3fb950', '#d29922', '#bc8cff', '#ff7b72', '#0891b2', '#059669', '#ea580c', '#c026d3', '#4f46e5'];
    const mapping = {};
    let colorIndex = 0;
    
    Object.keys(asmTerritory).forEach(asm => {
      mapping[asm] = colors[colorIndex % colors.length];
      colorIndex++;
    });
    mapping['N/A'] = '#8b949e';
    return mapping;
  }, []);

  const markers = useMemo(() => {
    const points = [];
    
    data.forEach(liveRecord => {
      if (liveRecord.location) {
        const parts = liveRecord.location.split(/[,\s]+/).map(p => parseFloat(p)).filter(p => !isNaN(p));
        if (parts.length >= 2) {
          const asm = liveRecord.asmName || 'N/A';
          points.push({
            id: `asm-${liveRecord.name}-${Math.random()}`,
            name: liveRecord.name,
            coords: { lat: parts[0], lng: parts[1] },
            asmName: asm,
            city: liveRecord.currentCity || 'Unknown',
            isPresent: liveRecord.isPresent
          });
        }
      }
    });
    
    return points;
  }, [data]);

  // Compute Assigned Polygons for all ASMs
  const allTerritoryHulls = useMemo(() => {
    const hulls = {};
    Object.keys(asmTerritory).forEach(asm => {
      const pts = asmTerritory[asm]?.points || [];
      if (pts.length >= 3) {
        hulls[asm] = getConvexHull(pts);
      } else if (pts.length === 2) {
        const offset = 0.3;
        const expanded = [
          { lat: pts[0].lat + offset, lng: pts[0].lng + offset },
          { lat: pts[0].lat - offset, lng: pts[0].lng - offset },
          { lat: pts[1].lat + offset, lng: pts[1].lng - offset },
          { lat: pts[1].lat - offset, lng: pts[1].lng + offset }
        ];
        hulls[asm] = getConvexHull(expanded);
      } else if (pts.length === 1) {
        const p = pts[0];
        const offset = 0.3;
        hulls[asm] = [
          { lat: p.lat + offset, lng: p.lng + offset },
          { lat: p.lat - offset, lng: p.lng + offset },
          { lat: p.lat - offset, lng: p.lng - offset },
          { lat: p.lat + offset, lng: p.lng - offset }
        ];
      }
    });
    return hulls;
  }, []);

  // Compute stats for selected ASM
  const asmStats = useMemo(() => {
    if (!selectedAsm) return null;
    const asmMarkers = markers.filter(m => m.asmName.toLowerCase() === selectedAsm.toLowerCase());
    
    // Calculate live covered polygon
    let coveredHull = [];
    if (asmMarkers.length >= 3) {
       coveredHull = getConvexHull(asmMarkers.map(m => m.coords));
    } else if (asmMarkers.length === 2) {
       const offset = 0.3;
       const pts = asmMarkers.map(m => m.coords);
       const expanded = [
          { lat: pts[0].lat + offset, lng: pts[0].lng + offset },
          { lat: pts[0].lat - offset, lng: pts[0].lng - offset },
          { lat: pts[1].lat + offset, lng: pts[1].lng - offset },
          { lat: pts[1].lat - offset, lng: pts[1].lng + offset }
       ];
       coveredHull = getConvexHull(expanded);
    } else if (asmMarkers.length === 1) {
       const p = asmMarkers[0].coords;
       const offset = 0.3;
       coveredHull = [
          { lat: p.lat + offset, lng: p.lng + offset },
          { lat: p.lat - offset, lng: p.lng + offset },
          { lat: p.lat - offset, lng: p.lng - offset },
          { lat: p.lat + offset, lng: p.lng - offset }
       ];
    }

    const territory = asmTerritory[selectedAsm] || { cities: [], states: [] };
    const territoryCitiesList = territory.cities;
    
    // Check coverage nodes: Unique cities from assigned list that appear in markers
    const coveredAssignedCities = territoryCitiesList.filter(city => 
      asmMarkers.some(m => m.city.toLowerCase() === city.toLowerCase())
    );

    return {
      coveredCities: coveredAssignedCities.length,
      territoryCities: territoryCitiesList.length,
      cities: territoryCitiesList.join(', '),
      states: territory.states || [],
      coveredHull
    };
  }, [selectedAsm, markers]);

  return (
    <div style={{ height: '600px', width: '100%', position: 'relative', background: 'rgba(13, 17, 23, 0.4)', borderRadius: '16px', overflow: 'hidden', border: '1px solid rgba(48, 54, 61, 0.5)' }}>
      {/* Header Controls */}
      <div style={{ position: 'absolute', top: '20px', left: '20px', zIndex: 10, display: 'flex', gap: '12px', alignItems: 'center' }}>
        <select 
          value={selectedAsm || ''} 
          onChange={(e) => { setSelectedAsm(e.target.value || null); }}
          style={{
            background: 'rgba(13, 17, 23, 0.9)',
            color: '#c9d1d9',
            border: '1px solid var(--border-main)',
            padding: '8px 16px',
            borderRadius: '8px',
            fontSize: '0.85rem',
            outline: 'none',
            cursor: 'pointer',
            minWidth: '220px'
          }}
        >
          <option value="">Select Area Sales Manager...</option>
          {Object.keys(asmTerritory).sort().map(asm => (
            <option key={asm} value={asm}>{asm}</option>
          ))}
        </select>

      </div>

      <ComposableMap
        projection="geoMercator"
        projectionConfig={{
          scale: 1200,
          center: [80, 22], 
        }}
        style={{ width: "100%", height: "100%" }}
      >
        <Geographies geography={indiaTopo}>
          {({ geographies }) =>
            geographies.map((geo) => {
              const isHighlightedState = selectedAsm && asmStats?.states?.includes(geo.properties.name);
              return (
                <Geography
                  key={geo.rsmKey}
                  geography={geo}
                  style={{
                    default: {
                      fill: isHighlightedState ? "rgba(88, 166, 255, 0.1)" : "rgba(88, 166, 255, 0.03)",
                      stroke: "rgba(255,255,255,0.1)",
                      strokeWidth: 0.5,
                      outline: "none",
                    },
                    hover: { fill: "rgba(88, 166, 255, 0.1)", outline: "none" },
                    pressed: { outline: "none" },
                  }}
                />
              );
            })
          }
        </Geographies>

        {/* Assigned Area Polygons */}
        {Object.entries(allTerritoryHulls).map(([asm, hull]) => {
           if (selectedAsm !== asm) return null;
           
           return (
             <Geography 
               key={`territory-${asm}`}
               geography={{
                 type: 'Feature',
                 geometry: {
                   type: 'Polygon',
                   coordinates: [[...hull.map(p => [p.lng, p.lat]), [hull[0].lng, hull[0].lat]]]
                 }
               }}
               style={{
                 default: { 
                   fill: asmColors[asm], 
                   fillOpacity: 0.7, 
                   stroke: asmColors[asm], 
                   strokeWidth: 2, 
                   strokeOpacity: 0.9,
                   outline: 'none',
                   transition: 'all 0.3s'
                 },
                 hover: { fill: asmColors[asm], fillOpacity: 0.8, strokeWidth: 2, outline: 'none', cursor: 'pointer' },
                 pressed: { outline: 'none' }
               }}
               onClick={() => { setSelectedAsm(asm); }}
             />
           );
        })}

        {/* Covered Area Polygon (Live) */}
        {selectedAsm && asmStats?.coveredHull && asmStats.coveredHull.length >= 3 && (
           <Geography 
             geography={{
               type: 'Feature',
               geometry: {
                 type: 'Polygon',
                 coordinates: [[...asmStats.coveredHull.map(p => [p.lng, p.lat]), [asmStats.coveredHull[0].lng, asmStats.coveredHull[0].lat]]]
               }
             }}
             style={{
               default: { fill: '#3fb950', fillOpacity: 0.5, stroke: '#3fb950', strokeWidth: 2, strokeDasharray: '4 4', outline: 'none' },
               hover: { outline: 'none' },
               pressed: { outline: 'none' }
             }}
           />
        )}

        {/* Assigned City Markers (Nodes) */}
        {selectedAsm && asmTerritory[selectedAsm]?.points?.map((p, idx) => (
          <Marker key={`node-${selectedAsm}-${idx}`} coordinates={[p.lng, p.lat]}>
            <circle 
              r={3} 
              fill={asmColors[selectedAsm]} 
              stroke="#fff" 
              strokeWidth={0.5} 
              style={{ 
                filter: 'drop-shadow(0 0 2px rgba(0,0,0,0.5))',
                cursor: 'pointer',
                transition: 'all 0.2s'
              }}
              onMouseEnter={(e) => e.target.setAttribute('r', '5')}
              onMouseLeave={(e) => e.target.setAttribute('r', '3')}
            />
          </Marker>
        ))}
      </ComposableMap>
      
      {/* Selection Info Popup */}
      {selectedAsm && asmStats && (
        <div style={{ 
          position: 'absolute', 
          bottom: '24px', 
          left: '24px', 
          width: '320px',
          background: 'rgba(13, 17, 23, 0.95)', 
          backdropFilter: 'blur(20px)',
          padding: '16px', 
          borderRadius: '12px', 
          border: `1px solid ${asmColors[selectedAsm]}`,
          boxShadow: '0 12px 48px rgba(0,0,0,0.5)',
          animation: 'slideUp 0.3s ease',
          zIndex: 20
        }}>
          <button 
            onClick={() => setSelectedAsm(null)}
            style={{ position: 'absolute', top: '12px', right: '12px', background: 'none', border: 'none', color: '#8b949e', cursor: 'pointer' }}
          >
            <X size={14} />
          </button>
          
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px' }}>
            <div style={{ 
              width: '40px', 
              height: '40px', 
              borderRadius: '10px', 
              background: 'rgba(255,255,255,0.03)', 
              display: 'flex', 
              alignItems: 'center', 
              justifyContent: 'center',
              color: asmColors[selectedAsm]
            }}>
              <MapIcon size={18} />
            </div>
            <div>
              <h4 style={{ margin: 0, fontSize: '0.9rem', color: '#fff', fontWeight: '700' }}>{selectedAsm}</h4>
              <span style={{ fontSize: '0.7rem', color: '#8b949e' }}>Area Sales Manager</span>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <div style={{ padding: '8px 12px', background: 'rgba(255,255,255,0.02)', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.05)' }}>
              <div style={{ fontSize: '0.65rem', color: '#8b949e', textTransform: 'uppercase', marginBottom: '4px' }}>Territory Details</div>
              <div style={{ fontSize: '0.8rem', color: '#c9d1d9', display: 'flex', alignItems: 'flex-start', gap: '6px', maxHeight: '80px', overflowY: 'auto', paddingRight: '4px' }}>
                <MapPin size={12} color={asmColors[selectedAsm]} style={{ marginTop: '2px', flexShrink: 0 }} /> 
                <span style={{ lineHeight: 1.4, wordBreak: 'break-word' }}>{asmStats.cities || 'Various Locations'}</span>
              </div>
            </div>

            <div style={{ padding: '8px 12px', background: 'rgba(88, 166, 255, 0.05)', borderRadius: '8px', border: '1px solid rgba(88, 166, 255, 0.1)' }}>
              <div style={{ fontSize: '0.65rem', color: '#8b949e', textTransform: 'uppercase', marginBottom: '4px' }}>Assigned States</div>
              <div style={{ fontSize: '0.75rem', color: '#fff', fontWeight: '600' }}>
                {asmStats.states.length > 0 ? asmStats.states.join(', ') : 'N/A'}
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
              <div style={{ padding: '12px 8px', background: 'rgba(255,255,255,0.02)', borderRadius: '8px', textAlign: 'center' }}>
                <div style={{ fontSize: '0.65rem', color: '#8b949e', textTransform: 'uppercase', marginBottom: '4px' }}>Area Assigned</div>
                <div style={{ fontSize: '1.2rem', color: asmColors[selectedAsm] || '#fff', fontWeight: '800' }}>{asmStats.territoryCities} Nodes</div>
              </div>
              <div style={{ padding: '12px 8px', background: 'rgba(63, 185, 80, 0.05)', borderRadius: '8px', textAlign: 'center', border: '1px solid rgba(63, 185, 80, 0.1)' }}>
                <div style={{ fontSize: '0.65rem', color: '#3fb950', textTransform: 'uppercase', marginBottom: '4px' }}>Area Covered</div>
                <div style={{ fontSize: '1.2rem', color: '#3fb950', fontWeight: '800' }}>{asmStats.coveredCities} Nodes</div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Legend & Labels */}
      <div style={{ 
        position: 'absolute', 
        top: '80px', 
        right: '20px', 
        display: 'flex',
        flexDirection: 'column',
        gap: '8px'
      }}>
        <div style={{ 
          background: 'rgba(13, 17, 23, 0.8)', 
          padding: '12px', 
          borderRadius: '10px', 
          border: '1px solid var(--border-main)',
          fontSize: '0.75rem',
          color: '#c9d1d9',
          backdropFilter: 'blur(10px)'
        }}>
          <strong>Map Legend</strong>
          <div style={{ marginTop: '8px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <div style={{ width: '10px', height: '10px', background: 'var(--accent-primary)', opacity: 0.4 }}></div>
              <span>Assigned Territory</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <div style={{ width: '10px', height: '10px', border: '2px dashed #3fb950', background: 'rgba(63, 185, 80, 0.2)' }}></div>
              <span>Actual Area Covered</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export { AsmCoverageMap };
