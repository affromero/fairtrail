'use client';

import { useEffect, useRef, useState } from 'react';
import { Map, Marker, NavigationControl, setWorkerUrl, addProtocol, removeProtocol } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { HotelMapProperty } from '@/lib/hotels/map-results';
import { DEFAULT_HOTEL_MAP_CONFIG, type HotelMapConfig } from '@/lib/hotels/map-config';
import { fetchHotelMapResource } from '@/lib/hotels/map-resources';
import styles from './HotelMap.module.css';

export interface HotelMapPin { property: HotelMapProperty; label: string; totalPrice: number; description: string }
interface Props {
  pins: HotelMapPin[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  styleUrl: string;
  config?: HotelMapConfig;
  loadingLabel: string;
  errorLabel: string;
  retryLabel: string;
  mapLabel: string;
  overlapLabel: string;
  closeLabel: string;
}

export function HotelMapCanvas({ pins, selectedId, onSelect, styleUrl, config = DEFAULT_HOTEL_MAP_CONFIG, loadingLabel, errorLabel, retryLabel, mapLabel, overlapLabel, closeLabel }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<Map | null>(null);
  const markersRef = useRef<{ ids: string[]; marker: Marker }[]>([]);
  const selectRef = useRef(onSelect);
  selectRef.current = onSelect;
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [attempt, setAttempt] = useState(0);
  const [overlapIds, setOverlapIds] = useState<string[]>([]);
  const overlapPins = pins.filter(pin => overlapIds.includes(pin.property.id));

  useEffect(() => {
    if (!container.current) return;
    let map: Map | undefined;
    let disposed = false;
    let failed = false;
    setStatus('loading');
    const protocol = `hotelmap${crypto.randomUUID().replaceAll('-', '')}`;
    addProtocol(protocol, async (request, controller) => ({ data: await fetchHotelMapResource(decodeURIComponent(request.url.slice(protocol.length + 3)), config, window.location.origin, request.type, controller.signal) }));
    const timer = setTimeout(() => { if (!disposed) setStatus('error'); }, 20000);
    try {
      const probe = document.createElement('canvas').getContext('webgl2');
      if (!probe) throw new Error('WebGL2 is unavailable');
      probe.getExtension('WEBGL_lose_context')?.loseContext();
      setWorkerUrl(`${window.location.origin}/maplibre/${process.env.NEXT_PUBLIC_MAPLIBRE_VERSION}/maplibre-gl-worker.mjs`);
      map = new Map({ container: container.current, style: styleUrl, center: [0, 0], zoom: 2, attributionControl: { compact: false }, cooperativeGestures: true,
        transformRequest: url => ({ url: `${protocol}://${encodeURIComponent(url)}` }),
      });
      mapRef.current = map;
      map.addControl(new NavigationControl({ showCompass: false }), 'top-right');
      map.on('load', () => { if (!disposed && !failed) { clearTimeout(timer); setStatus('ready'); } });
      map.on('error', () => { if (!disposed) { failed = true; clearTimeout(timer); setStatus('error'); } });
      map.getCanvas().setAttribute('aria-label', mapLabel);
      map.getCanvas().addEventListener('webglcontextlost', () => { if (!disposed) setStatus('error'); });
    } catch {
      clearTimeout(timer);
      setStatus('error');
    }
    const resize = new ResizeObserver(() => map?.resize());
    resize.observe(container.current);
    return () => { disposed = true; clearTimeout(timer); resize.disconnect(); mapRef.current = null; map?.remove(); removeProtocol(protocol); };
  }, [styleUrl, config, attempt, mapLabel]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    setOverlapIds([]);
    const groups = new globalThis.Map<string, HotelMapPin[]>();
    for (const pin of pins) {
      const key = `${pin.property.location.longitude},${pin.property.location.latitude}`;
      groups.set(key, [...(groups.get(key) ?? []), pin]);
    }
    const markers = [...groups.values()].map(group => {
      const pin = group.reduce((lowest, candidate) => candidate.totalPrice < lowest.totalPrice ? candidate : lowest);
      const ids = group.map(entry => entry.property.id);
      const element = document.createElement('button');
      element.type = 'button';
      element.className = styles.pin!;
      element.textContent = group.length > 1 ? `${pin.label} · ${group.length}` : pin.label;
      element.setAttribute('aria-label', group.length > 1 ? `${overlapLabel}: ${group.length}` : pin.description);
      element.setAttribute('aria-pressed', 'false');
      element.addEventListener('click', () => {
        if (group.length > 1) { setOverlapIds(ids); return; }
        setOverlapIds([]);
        selectRef.current(pin.property.id);
      });
      return { ids, marker: new Marker({ element }).setLngLat([pin.property.location.longitude, pin.property.location.latitude]).addTo(map) };
    });
    markersRef.current = markers;
    if (pins.length) {
      const longitudes = pins.map(pin => pin.property.location.longitude);
      const latitudes = pins.map(pin => pin.property.location.latitude);
      map.fitBounds([[Math.min(...longitudes), Math.min(...latitudes)], [Math.max(...longitudes), Math.max(...latitudes)]], { padding: 70, maxZoom: 15, duration: 0 });
    }
    return () => { markers.forEach(entry => entry.marker.remove()); markersRef.current = []; };
  }, [pins, styleUrl, config, attempt, mapLabel, overlapLabel]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    for (const { ids, marker } of markersRef.current) marker.getElement().setAttribute('aria-pressed', String(selectedId !== null && ids.includes(selectedId)));
    const selected = pins.find(pin => pin.property.id === selectedId);
    if (selected) map.easeTo({ center: [selected.property.location.longitude, selected.property.location.latitude], zoom: Math.max(map.getZoom(), 14), duration: 0 });
  }, [pins, selectedId, styleUrl, config, attempt, mapLabel]);

  return <div className={styles.canvasWrap}>
    <div ref={container} className={styles.canvas} aria-label={mapLabel} />
    {status === 'ready' && overlapPins.length > 1 && <div role="group" aria-label={overlapLabel} className={styles.overlap}>
      <p>{overlapLabel}</p>
      {overlapPins.map(pin => <button key={pin.property.id} type="button" aria-pressed={selectedId === pin.property.id} onClick={() => onSelect(pin.property.id)}>{pin.property.name} · {pin.label}</button>)}
      <button type="button" onClick={() => { setOverlapIds([]); markersRef.current.find(entry => entry.ids.includes(overlapIds[0] ?? ''))?.marker.getElement().focus(); }}>{closeLabel}</button>
    </div>}
    {status === 'loading' && <p role="status" className={styles.message}>{loadingLabel}</p>}
    {status === 'error' && <div role="alert" className={styles.message}><p>{errorLabel}</p><button type="button" onClick={() => { setStatus('loading'); setAttempt(value => value + 1); }}>{retryLabel}</button></div>}
  </div>;
}
