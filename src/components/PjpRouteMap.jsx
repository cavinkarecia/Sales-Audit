import React, { useEffect, useMemo } from 'react';
import { MapContainer, TileLayer, Polyline, CircleMarker, Popup, useMap } from 'react-leaflet';
import { findCityCoords } from '../utils/geoUtils';

const FitBounds = ({ positions }) => {
  const map = useMap();
  useEffect(() => {
    if (!positions.length) return;
    if (positions.length === 1) {
      map.setView(positions[0], 10);
      return;
    }
    map.fitBounds(positions, { padding: [36, 36] });
  }, [positions, map]);
  return null;
};

/** Step 2 — plot PJP from/to towns for legs on a given date (or all loaded PJP). */
const PjpRouteMap = ({ pjpLegs, height = '300px' }) => {
  const { polylines, markers, fit } = useMemo(() => {
    const polylines = [];
    const markers = [];
    const fit = [];

    (pjpLegs || []).forEach((leg, idx) => {
      const from = findCityCoords(leg.fromTown || leg.from, leg.state);
      const to = findCityCoords(leg.toTown || leg.to, leg.state);
      if (from && to) {
        const positions = [
          [from.lat, from.lng],
          [to.lat, to.lng],
        ];
        polylines.push({ id: idx, positions, label: `${leg.fromTown} → ${leg.toTown}` });
        fit.push(...positions);
        markers.push(
          { pos: positions[0], label: leg.fromTown, sub: leg.employeeName },
          { pos: positions[1], label: leg.toTown, sub: `${leg.kms || '?'} km` },
        );
      }
    });

    return { polylines, markers, fit };
  }, [pjpLegs]);

  if (!polylines.length) {
    return (
      <div style={{ height, display: 'grid', placeItems: 'center', color: 'var(--text-secondary)', fontSize: '0.8rem' }}>
        No geocoded PJP routes (add cities.json from upstream repo for town matching)
      </div>
    );
  }

  const center = fit[0];

  return (
    <MapContainer center={center} zoom={7} style={{ height, width: '100%', borderRadius: 8 }} scrollWheelZoom>
      <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution="© OpenStreetMap" />
      <FitBounds positions={fit} />
      {polylines.map((pl) => (
        <Polyline key={pl.id} positions={pl.positions} pathOptions={{ color: '#58a6ff', weight: 3 }} />
      ))}
      {markers.map((m, i) => (
        <CircleMarker key={i} center={m.pos} radius={7} pathOptions={{ color: '#3fb950', fillColor: '#3fb950', fillOpacity: 0.9 }}>
          <Popup>
            <strong>{m.label}</strong>
            <br />
            {m.sub}
          </Popup>
        </CircleMarker>
      ))}
    </MapContainer>
  );
};

export default PjpRouteMap;
