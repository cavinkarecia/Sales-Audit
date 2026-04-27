import React, { useMemo, useState } from 'react';
import {
  ComposableMap,
  Geographies,
  Geography,
  Marker,
  Line,
} from 'react-simple-maps';
import { MapPin, X, Home, Navigation, Info } from 'lucide-react';

import indiaTopo from '../data/india_topo.json';
import { getDistance, findNearestCity } from '../utils/geoUtils';

const IndiaLiveMap = ({ data, auditorsMaster }) => {
  const [selectedPoint, setSelectedPoint] = useState(null);

  const deployments = useMemo(() => {
    const markers = [];
    
    auditorsMaster.forEach(auditor => {
      // Add Base Location Marker
      if (auditor.coords) {
        markers.push({
          id: `base-${auditor.name}`,
          name: auditor.name,
          type: 'Base',
          coords: auditor.coords,
          cluster: auditor.cluster,
          homeCity: auditor.location,
          empCode: auditor.empCode
        });
      }

      // Add Live Location Marker
      const liveRecord = data.find(d => d.name.toLowerCase() === auditor.name.toLowerCase());
      if (liveRecord && liveRecord.location) {
        const parts = liveRecord.location.split(/[,\s]+/).map(p => parseFloat(p)).filter(p => !isNaN(p));
        if (parts.length >= 2) {
          const currentCoords = { lat: parts[0], lng: parts[1] };
          const distance = auditor.coords ? getDistance(auditor.coords.lat, auditor.coords.lng, currentCoords.lat, currentCoords.lng) : null;
          
          // Reverse geocode to find the actual city
          const currentCity = findNearestCity(currentCoords.lat, currentCoords.lng);
          
          markers.push({
            id: `live-${auditor.name}`,
            name: auditor.name,
            type: 'Live',
            coords: currentCoords,
            cluster: liveRecord.cluster || auditor.cluster,
            isPresent: liveRecord.isPresent,
            baseCoords: auditor.coords,
            distance: distance,
            homeCity: auditor.location,
            currentCity: currentCity
          });
        }
      }
    });
    
    return markers;
  }, [data, auditorsMaster]);

  return (
    <div style={{ height: '600px', width: '100%', position: 'relative', background: 'rgba(13, 17, 23, 0.4)', borderRadius: '16px', overflow: 'hidden', border: '1px solid rgba(48, 54, 61, 0.5)' }}>
      <ComposableMap
        projection="geoMercator"
        projectionConfig={{
          scale: 1000,
          center: [80, 22], 
        }}
        style={{ width: "100%", height: "100%" }}
      >
        <Geographies geography={indiaTopo}>
          {({ geographies }) =>
            geographies.map((geo) => {
              const stateName = geo.properties.name || geo.properties.NAME_1 || "State";
              return (
                <Geography
                  key={geo.rsmKey}
                  geography={geo}
                  style={{
                    default: {
                      fill: "rgba(88, 166, 255, 0.05)",
                      stroke: "rgba(255,255,255,0.15)",
                      strokeWidth: 0.8,
                      outline: "none",
                    },
                    hover: {
                      fill: "rgba(88, 166, 255, 0.15)",
                      stroke: "rgba(88, 166, 255, 0.5)",
                      strokeWidth: 1.2,
                      outline: "none",
                      cursor: 'pointer'
                    },
                    pressed: {
                      fill: "rgba(88, 166, 255, 0.2)",
                      outline: "none",
                    },
                  }}
                />
              );
            })
          }
        </Geographies>

        {deployments.map((d) => (
          <React.Fragment key={d.id}>
            {d.type === 'Live' && d.baseCoords && (
              <Line
                from={[d.baseCoords.lng, d.baseCoords.lat]}
                to={[d.coords.lng, d.coords.lat]}
                stroke="var(--accent-primary)"
                strokeWidth={0.6}
                strokeDasharray="2 2"
                opacity={0.3}
              />
            )}

            <Marker coordinates={[d.coords.lng, d.coords.lat]}>
              {d.type === 'Base' ? (
                <circle 
                  r={selectedPoint?.name === d.name && selectedPoint?.type === 'Base' ? 4 : 2} 
                  fill={selectedPoint?.name === d.name && selectedPoint?.type === 'Base' ? "var(--accent-primary)" : "rgba(139, 148, 158, 0.5)"} 
                  stroke="#fff" 
                  strokeWidth={0.3}
                  style={{ cursor: 'pointer', transition: 'all 0.2s' }}
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelectedPoint(d);
                  }}
                />
              ) : (
                <g 
                  transform="translate(-6, -12) scale(0.8)" 
                  style={{ cursor: 'pointer' }}
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelectedPoint(d);
                  }}
                >
                  <path
                    d="M6 0C2.686 0 0 2.686 0 6c0 4.5 6 10 6 10s6-5.5 6-10c0-3.314-2.686-6-6-6zm0 8c-1.105 0-2-.895-2-2s.895-2 2-2 2 .895 2 2-.895 2-2 2z"
                    fill={d.isPresent ? "#3fb950" : "#f85149"}
                    stroke="white"
                    strokeWidth={selectedPoint?.id === d.id ? 1.5 : 0.5}
                  />
                </g>
              )}
            </Marker>
          </React.Fragment>
        ))}
      </ComposableMap>
      
      {/* Selection Info Popup - Professional Detail View */}
      {selectedPoint && (
        <div style={{ 
          position: 'absolute', 
          bottom: '24px', 
          left: '24px', 
          width: '280px',
          background: 'rgba(13, 17, 23, 0.95)', 
          backdropFilter: 'blur(20px)',
          padding: '16px', 
          borderRadius: '12px', 
          border: `1px solid ${selectedPoint.type === 'Base' ? '#58a6ff' : (selectedPoint.isPresent ? '#3fb950' : '#f85149')}`,
          boxShadow: '0 12px 48px rgba(0,0,0,0.5)',
          animation: 'slideUp 0.3s ease',
          zIndex: 100
        }}>
          <button 
            onClick={() => setSelectedPoint(null)}
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
              color: selectedPoint.type === 'Base' ? '#58a6ff' : (selectedPoint.isPresent ? '#3fb950' : '#f85149')
            }}>
              {selectedPoint.type === 'Base' ? <Home size={18} /> : <Navigation size={18} />}
            </div>
            <div>
              <h4 style={{ margin: 0, fontSize: '0.9rem', color: '#fff', fontWeight: '700' }}>{selectedPoint.name}</h4>
              <span style={{ fontSize: '0.7rem', color: '#8b949e' }}>Sales Auditor • {selectedPoint.empCode || 'Staff'}</span>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <div style={{ padding: '8px 12px', background: 'rgba(255,255,255,0.02)', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.05)' }}>
              <div style={{ fontSize: '0.65rem', color: '#8b949e', textTransform: 'uppercase', marginBottom: '4px' }}>Base Location</div>
              <div style={{ fontSize: '0.8rem', color: '#c9d1d9', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <MapPin size={12} color="#58a6ff" /> {selectedPoint.homeCity}
              </div>
            </div>

            {selectedPoint.type === 'Live' && (
              <>
                <div style={{ padding: '8px 12px', background: 'rgba(255,255,255,0.02)', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.05)' }}>
                  <div style={{ fontSize: '0.65rem', color: '#8b949e', textTransform: 'uppercase', marginBottom: '4px' }}>Current Location</div>
                  <div style={{ fontSize: '0.8rem', color: '#c9d1d9', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <Info size={12} color="var(--accent-primary)" /> {selectedPoint.currentCity}
                  </div>
                </div>

                <div style={{ padding: '8px 12px', background: 'rgba(63, 185, 80, 0.05)', borderRadius: '8px', border: '1px solid rgba(63, 185, 80, 0.1)' }}>
                  <div style={{ fontSize: '0.65rem', color: '#3fb950', textTransform: 'uppercase', marginBottom: '4px' }}>Proximity to Base</div>
                  <div style={{ fontSize: '1rem', color: '#fff', fontWeight: '800' }}>
                    {selectedPoint.distance} <span style={{ fontSize: '0.7rem', fontWeight: '400' }}>KM AWAY</span>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Simplified Legend */}
      <div style={{ 
        position: 'absolute', 
        top: '20px', 
        right: '20px', 
        background: 'rgba(13, 17, 23, 0.7)', 
        padding: '12px', 
        borderRadius: '10px', 
        border: '1px solid var(--border-main)',
        pointerEvents: 'none'
      }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <div style={{ width: '6px', height: '6px', background: 'rgba(139, 148, 158, 0.8)', borderRadius: '50%' }}></div>
            <span style={{ fontSize: '0.7rem', color: '#8b949e' }}>Home Base</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <div style={{ width: '8px', height: '12px', background: '#3fb950', clipPath: 'polygon(50% 0%, 100% 38%, 82% 100%, 18% 100%, 0% 38%)' }}></div>
            <span style={{ fontSize: '0.7rem', color: '#8b949e' }}>Live: Present</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <div style={{ width: '8px', height: '12px', background: '#f85149', clipPath: 'polygon(50% 0%, 100% 38%, 82% 100%, 18% 100%, 0% 38%)' }}></div>
            <span style={{ fontSize: '0.7rem', color: '#8b949e' }}>Live: Absent</span>
          </div>
        </div>
      </div>

      <style>{`
        @keyframes slideUp {
          from { transform: translateY(12px); opacity: 0; }
          to { transform: translateY(0); opacity: 1; }
        }
      `}</style>
    </div>
  );
};

export default IndiaLiveMap;
