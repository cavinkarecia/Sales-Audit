import React, { useEffect, useMemo, useRef } from 'react';
import {
  MapContainer,
  TileLayer,
  Marker,
  Polyline,
  Popup,
  CircleMarker,
  Tooltip,
  useMap,
  ZoomControl,
} from 'react-leaflet';
import L from 'leaflet';

import { dayColor } from '../utils/travelMapUtils';
import { findCityCoords, findNearestCity, getDistance } from '../utils/geoUtils';

/**
 * Build an HTML divIcon styled as a coloured map-pin. We use SVG so the
 * pin is sharp at any zoom level and avoids Leaflet's default icon-path
 * problem when bundled with Vite.
 */
const buildPinIcon = (fill, label, opts = {}) => {
  const { size = 28, badge = '' } = opts;
  const w = size;
  const h = Math.round(size * 1.25);
  const html = `
    <div class="lf-pin" style="position:relative;width:${w}px;height:${h}px;">
      <svg viewBox="0 0 24 30" width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg" style="filter: drop-shadow(0 2px 4px rgba(0,0,0,0.5));">
        <path d="M12 0C5.37 0 0 5.37 0 12c0 9 12 18 12 18s12-9 12-18C24 5.37 18.63 0 12 0z" fill="${fill}" stroke="#fff" stroke-width="1.5"/>
        <circle cx="12" cy="12" r="4.5" fill="#fff"/>
      </svg>
      ${badge ? `<div style="position:absolute;top:-4px;right:-4px;background:${fill};color:#fff;font-family:Inter,sans-serif;font-size:9px;font-weight:800;line-height:1;padding:2px 4px;border-radius:8px;border:1px solid #fff;min-width:14px;text-align:center;">${badge}</div>` : ''}
      ${label ? `<div style="position:absolute;left:50%;top:${h + 2}px;transform:translateX(-50%);background:rgba(13,17,23,0.95);color:#fff;font-family:Inter,sans-serif;font-size:10px;font-weight:700;padding:2px 6px;border-radius:6px;white-space:nowrap;border:1px solid rgba(255,255,255,0.15);">${label}</div>` : ''}
    </div>
  `;
  return L.divIcon({
    className: 'lf-pin-wrapper',
    html,
    iconSize: [w, h],
    iconAnchor: [w / 2, h],
    popupAnchor: [0, -h],
  });
};

/**
 * Helper that calls map.fitBounds whenever the supplied points change.
 * Lives inside MapContainer so it can grab the map instance via useMap().
 */
const FitBounds = ({ points, padding = 40 }) => {
  const map = useMap();
  useEffect(() => {
    if (!points || points.length === 0) return;
    const latlngs = points
      .filter(p => p && typeof p.lat === 'number' && typeof p.lng === 'number')
      .map(p => [p.lat, p.lng]);
    if (latlngs.length === 0) return;
    if (latlngs.length === 1) {
      map.setView(latlngs[0], 11, { animate: true });
      return;
    }
    const bounds = L.latLngBounds(latlngs);
    map.fitBounds(bounds, { padding: [padding, padding], maxZoom: 14 });
  }, [points, padding, map]);
  return null;
};

/**
 * Interactive Google-Maps-style travel map.
 *
 * Props (compatible with the previous IndiaLiveMap):
 *   data            - live attendance records (with lat,lng in record.location)
 *   auditorsMaster  - auditor master list with .coords
 *   historyData     - legacy unstructured history rows
 *   travelLegs      - structured legs from buildTravelLegs() (preferred)
 *   height          - css height (default 600px)
 */
const LeafletTravelMap = ({
  data,
  auditorsMaster = [],
  historyData = [],
  travelLegs = null,
  height = '600px',
}) => {
  const isLegMode = Array.isArray(travelLegs) && travelLegs.length > 0;
  const isHistoryMode = !isLegMode && historyData && historyData.length > 0;
  const containerRef = useRef(null);

  /* ------------------------------------------------------------------ *
   *  Compute markers + polylines for the chosen mode                    *
   * ------------------------------------------------------------------ */
  const { markers, polylines, fitPoints } = useMemo(() => {
    const m = [];
    const p = [];
    const fits = [];

    if (isLegMode) {
      const seenMarker = new Set();
      travelLegs.forEach((leg) => {
        const color = dayColor(leg.dayIndex);

        if (leg.fromCoords && leg.toCoords) {
          p.push({
            id: `line-${leg.id}`,
            color,
            positions: [
              [leg.fromCoords.lat, leg.fromCoords.lng],
              [leg.toCoords.lat, leg.toCoords.lng],
            ],
            tooltip: `Day ${leg.dayIndex} • ${leg.date}\n${leg.fromTown} → ${leg.toTown}\n${leg.kms != null ? Math.round(leg.kms) + ' km' : ''}`,
          });
          fits.push({ lat: leg.fromCoords.lat, lng: leg.fromCoords.lng });
          fits.push({ lat: leg.toCoords.lat, lng: leg.toCoords.lng });
        } else if (leg.fromCoords) {
          fits.push({ lat: leg.fromCoords.lat, lng: leg.fromCoords.lng });
        } else if (leg.toCoords) {
          fits.push({ lat: leg.toCoords.lat, lng: leg.toCoords.lng });
        }

        const pushMarker = (kind, town, coords, matched) => {
          if (!coords) return;
          const key = `${kind}-${(town || '').toLowerCase()}-${coords.lat.toFixed(3)}-${coords.lng.toFixed(3)}`;
          if (seenMarker.has(key)) return;
          seenMarker.add(key);
          m.push({
            id: `m-${kind}-${leg.id}`,
            kind: 'leg',
            position: [coords.lat, coords.lng],
            color,
            label: town || matched || '?',
            badge: `D${leg.dayIndex}`,
            popup: {
              title: town || matched || 'Travel Point',
              meta: `Day ${leg.dayIndex} • ${leg.date}`,
              employee: leg.employeeName,
              matched: (matched && town && matched.toLowerCase() !== town.toLowerCase()) ? matched : null,
              kms: leg.kms != null ? Math.round(leg.kms) : null,
              fromTown: leg.fromTown,
              toTown: leg.toTown,
            },
          });
        };
        pushMarker('from', leg.fromTown, leg.fromCoords, leg.fromMatchedCity);
        pushMarker('to', leg.toTown, leg.toCoords, leg.toMatchedCity);
      });
      return { markers: m, polylines: p, fitPoints: fits };
    }

    if (isHistoryMode) {
      historyData.forEach((h, idx) => {
        const empName = h.employeeName || h['Employee Name'] || '';
        const fromTown = h.fromTown || h['From Town Name'] || '';
        const toTown = h.toTown || h['To Town Name'] || '';
        const dateVal = h.date || h['Date'] || '';
        const state = h.state || h['State'] || '';

        const auditor = auditorsMaster.find(a =>
          a.name.toLowerCase().includes(empName.toLowerCase()) ||
          empName.toLowerCase().includes(a.name.toLowerCase())
        );

        let fromCoords = findCityCoords(fromTown, state);
        const toCoords = findCityCoords(toTown, state);
        if (!fromCoords && auditor && auditor.coords) fromCoords = auditor.coords;

        if (fromCoords && toCoords) {
          p.push({
            id: `histline-${idx}`,
            color: '#58a6ff',
            positions: [
              [fromCoords.lat, fromCoords.lng],
              [toCoords.lat, toCoords.lng],
            ],
            tooltip: `${dateVal}\n${fromTown} → ${toTown}`,
          });
        }
        if (fromCoords) {
          m.push({
            id: `histfrom-${idx}`,
            kind: 'history',
            position: [fromCoords.lat, fromCoords.lng],
            color: '#3fb950',
            label: fromTown || 'Base',
            popup: { title: `From: ${fromTown || 'Base'}`, meta: dateVal, employee: empName },
          });
          fits.push({ lat: fromCoords.lat, lng: fromCoords.lng });
        }
        if (toCoords) {
          m.push({
            id: `histto-${idx}`,
            kind: 'history',
            position: [toCoords.lat, toCoords.lng],
            color: '#f85149',
            label: toTown,
            popup: { title: `To: ${toTown}`, meta: dateVal, employee: empName, kms: h.kms || h['Kms Travelled'] },
          });
          fits.push({ lat: toCoords.lat, lng: toCoords.lng });
        }
      });
      return { markers: m, polylines: p, fitPoints: fits };
    }

    if (data && data.length > 0) {
      const liveByAuditor = new Map();

      data.forEach((rec) => {
        if (!rec.name || !rec.location) return;
        const key = String(rec.name).toLowerCase().trim();
        const existing = liveByAuditor.get(key);
        const recDate = rec.chooseDateKey || rec.dayKey || '';
        const existingDate = existing?.chooseDateKey || existing?.dayKey || '';
        if (!existing || recDate >= existingDate) {
          liveByAuditor.set(key, rec);
        }
      });

      auditorsMaster.forEach((a) => {
        if (!a.coords) return;
        const aKey = a.name.toLowerCase();
        const isVisible = [...liveByAuditor.keys()].some(
          (k) => k.includes(aKey) || aKey.includes(k),
        );
        if (!isVisible) return;
        m.push({
          id: `base-${a.name}`,
          kind: 'base',
          position: [a.coords.lat, a.coords.lng],
          color: '#8b949e',
          radius: 5,
          label: '',
          popup: { title: a.name, meta: a.location, employee: a.empCode },
        });
        fits.push({ lat: a.coords.lat, lng: a.coords.lng });
      });

      liveByAuditor.forEach((rec) => {
        const parts = String(rec.location).split(/[,\s]+/).map((x) => parseFloat(x)).filter((x) => !Number.isNaN(x));
        if (parts.length < 2) return;

        const auditor = auditorsMaster.find(
          (x) =>
            x.name.toLowerCase().includes((rec.name || '').toLowerCase()) ||
            (rec.name || '').toLowerCase().includes(x.name.toLowerCase()),
        );

        const color = rec.isPresent ? '#3fb950' : '#f85149';
        m.push({
          id: `live-${rec.name}`,
          kind: 'live',
          position: [parts[0], parts[1]],
          color,
          label: rec.name,
          popup: {
            title: rec.name,
            meta: rec.isPresent ? 'On Field' : 'Offline',
            employee: auditor?.empCode || rec.empCode || '',
            currentCity: rec.currentCity || findNearestCity(parts[0], parts[1]),
            distance:
              rec.distanceFromBase != null && rec.distanceFromBase !== 'N/A'
                ? rec.distanceFromBase
                : auditor?.coords
                  ? getDistance(auditor.coords.lat, auditor.coords.lng, parts[0], parts[1])
                  : null,
          },
        });
        if (auditor?.coords) {
          p.push({
            id: `liveline-${rec.name}`,
            color: '#58a6ff',
            positions: [
              [auditor.coords.lat, auditor.coords.lng],
              [parts[0], parts[1]],
            ],
            dashed: true,
          });
        }
        fits.push({ lat: parts[0], lng: parts[1] });
      });
    } else {
      auditorsMaster.forEach((a) => {
        if (!a.coords) return;
        m.push({
          id: `base-${a.name}`,
          kind: 'base',
          position: [a.coords.lat, a.coords.lng],
          color: '#8b949e',
          radius: 5,
          label: '',
          popup: { title: a.name, meta: a.location, employee: a.empCode },
        });
        fits.push({ lat: a.coords.lat, lng: a.coords.lng });
      });
    }
    return { markers: m, polylines: p, fitPoints: fits };
  }, [data, auditorsMaster, historyData, travelLegs, isLegMode, isHistoryMode]);

  return (
    <div
      ref={containerRef}
      style={{
        height,
        width: '100%',
        position: 'relative',
        background: 'rgba(13, 17, 23, 0.4)',
        borderRadius: '16px',
        overflow: 'hidden',
        border: '1px solid rgba(48, 54, 61, 0.5)',
      }}
    >
      <MapContainer
        center={[22, 80]}
        zoom={5}
        minZoom={3}
        maxZoom={19}
        scrollWheelZoom
        worldCopyJump
        style={{ height: '100%', width: '100%' }}
        zoomControl={false}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          maxZoom={19}
        />
        <ZoomControl position="topleft" />

        <FitBounds points={fitPoints} />

        {polylines.map((pl) => (
          <Polyline
            key={pl.id}
            positions={pl.positions}
            pathOptions={{
              color: pl.color,
              weight: 3,
              opacity: 0.85,
              dashArray: pl.dashed ? '6 4' : null,
            }}
          >
            {pl.tooltip && (
              <Tooltip direction="center" sticky opacity={0.95}>
                <div style={{ whiteSpace: 'pre-line', fontSize: '0.7rem' }}>{pl.tooltip}</div>
              </Tooltip>
            )}
          </Polyline>
        ))}

        {markers.map((mk) => {
          if (mk.kind === 'base') {
            return (
              <CircleMarker
                key={mk.id}
                center={mk.position}
                radius={mk.radius || 5}
                pathOptions={{ color: mk.color, fillColor: mk.color, fillOpacity: 0.6, weight: 1 }}
              >
                <Popup>
                  <div style={{ fontFamily: 'Inter, sans-serif', minWidth: '180px' }}>
                    <div style={{ fontWeight: '700', fontSize: '0.85rem' }}>{mk.popup.title}</div>
                    <div style={{ fontSize: '0.75rem', color: '#586069' }}>Base: {mk.popup.meta}</div>
                    {mk.popup.employee && (
                      <div style={{ fontSize: '0.72rem', color: '#8b949e' }}>Emp Code: {mk.popup.employee}</div>
                    )}
                  </div>
                </Popup>
              </CircleMarker>
            );
          }
          return (
            <Marker
              key={mk.id}
              position={mk.position}
              icon={buildPinIcon(mk.color, mk.label, { size: 26, badge: mk.badge })}
            >
              <Popup>
                <div style={{ fontFamily: 'Inter, sans-serif', minWidth: '200px' }}>
                  <div style={{ fontWeight: '800', fontSize: '0.9rem', marginBottom: '4px' }}>{mk.popup.title}</div>
                  {mk.popup.meta && (
                    <div style={{ fontSize: '0.75rem', color: '#586069', marginBottom: '4px' }}>{mk.popup.meta}</div>
                  )}
                  {mk.popup.employee && (
                    <div style={{ fontSize: '0.72rem', color: '#444' }}>Auditor: {mk.popup.employee}</div>
                  )}
                  {mk.popup.matched && (
                    <div style={{ fontSize: '0.72rem', color: '#586069' }}>Matched: {mk.popup.matched}</div>
                  )}
                  {mk.popup.currentCity && (
                    <div style={{ fontSize: '0.72rem', color: '#444' }}>Current city: {mk.popup.currentCity}</div>
                  )}
                  {mk.popup.kms != null && mk.popup.kms !== '' && (
                    <div style={{ fontSize: '0.72rem', color: '#444' }}>Distance on this leg: {mk.popup.kms} km</div>
                  )}
                  {mk.popup.distance != null && (
                    <div style={{ fontSize: '0.72rem', color: '#444' }}>Distance from base: {mk.popup.distance} km</div>
                  )}
                  {mk.popup.fromTown && mk.popup.toTown && (
                    <div style={{ fontSize: '0.72rem', color: '#444', marginTop: '4px' }}>
                      Route: {mk.popup.fromTown} → {mk.popup.toTown}
                    </div>
                  )}
                </div>
              </Popup>
            </Marker>
          );
        })}
      </MapContainer>

      {/* Day legend overlay (leg-mode only) */}
      {isLegMode && (
        <div
          style={{
            position: 'absolute',
            top: '12px',
            right: '12px',
            zIndex: 500,
            background: 'rgba(13,17,23,0.92)',
            color: '#c9d1d9',
            border: '1px solid rgba(255,255,255,0.12)',
            borderRadius: '10px',
            padding: '8px 10px',
            maxWidth: '220px',
            maxHeight: '60%',
            overflowY: 'auto',
            backdropFilter: 'blur(6px)',
            boxShadow: '0 6px 24px rgba(0,0,0,0.35)',
          }}
        >
          <div style={{ fontSize: '0.62rem', textTransform: 'uppercase', letterSpacing: '0.5px', color: '#8b949e', marginBottom: '6px' }}>
            Date-wise Routes
          </div>
          {(() => {
            const seen = new Set();
            const items = [];
            travelLegs.forEach((leg) => {
              if (seen.has(leg.dayIndex)) return;
              seen.add(leg.dayIndex);
              items.push(
                <div key={`legend-d-${leg.dayIndex}`} style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '2px 0' }}>
                  <span style={{ width: '14px', height: '3px', background: dayColor(leg.dayIndex), borderRadius: '2px', display: 'inline-block' }} />
                  <span style={{ fontSize: '0.7rem' }}>Day {leg.dayIndex} • {leg.date}</span>
                </div>
              );
            });
            return items;
          })()}
        </div>
      )}

      {/* Hint banner */}
      <div
        style={{
          position: 'absolute',
          bottom: '10px',
          left: '12px',
          zIndex: 500,
          background: 'rgba(13,17,23,0.78)',
          color: '#8b949e',
          fontSize: '0.65rem',
          border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: '8px',
          padding: '4px 8px',
          pointerEvents: 'none',
        }}
      >
        Scroll / pinch to zoom · Drag to pan · Click a pin for details
      </div>
    </div>
  );
};

export default React.memo(LeafletTravelMap);
