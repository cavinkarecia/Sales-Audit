import React, { useEffect } from 'react';
import { MapContainer, TileLayer, CircleMarker, Popup, useMap } from 'react-leaflet';

const FitBounds = ({ points }) => {
  const map = useMap();
  useEffect(() => {
    if (!points.length) return;
    if (points.length === 1) {
      map.setView([points[0].lat, points[0].lng], 11);
      return;
    }
    const lats = points.map((p) => p.lat);
    const lngs = points.map((p) => p.lng);
    map.fitBounds(
      [
        [Math.min(...lats), Math.min(...lngs)],
        [Math.max(...lats), Math.max(...lngs)],
      ],
      { padding: [40, 40] },
    );
  }, [points, map]);
  return null;
};

const AttendanceMap = ({ records, height = '360px' }) => {
  const points = records
    .map((r) => {
      const parts = String(r.location || '')
        .split(/[,\s]+/)
        .map((p) => parseFloat(p))
        .filter((p) => !Number.isNaN(p));
      if (parts.length < 2) return null;
      return {
        lat: parts[0],
        lng: parts[1],
        name: r.name,
        present: r.isPresent,
        date: r.date,
      };
    })
    .filter(Boolean);

  if (!points.length) {
    return (
      <div style={{ height, display: 'grid', placeItems: 'center', color: 'var(--text-secondary)' }}>
        No GPS locations to plot
      </div>
    );
  }

  const center = points[0];

  return (
    <MapContainer
      center={[center.lat, center.lng]}
      zoom={8}
      style={{ height, width: '100%', borderRadius: 8 }}
      scrollWheelZoom
    >
      <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution="© OpenStreetMap" />
      <FitBounds points={points} />
      {points.map((p, i) => (
        <CircleMarker
          key={`${p.name}-${i}`}
          center={[p.lat, p.lng]}
          radius={8}
          pathOptions={{
            color: p.present ? '#3fb950' : '#f85149',
            fillColor: p.present ? '#3fb950' : '#f85149',
            fillOpacity: 0.85,
          }}
        >
          <Popup>
            <strong>{p.name}</strong>
            <br />
            {p.present ? 'On field (latest)' : 'Absent (latest)'}
            <br />
            {p.date instanceof Date ? p.date.toLocaleDateString() : String(p.date)}
          </Popup>
        </CircleMarker>
      ))}
    </MapContainer>
  );
};

export default AttendanceMap;
