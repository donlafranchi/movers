import type { OwnershipTier } from './types'

export const MAP_DEFAULTS = {
  center: [-98.5795, 39.8283] as [number, number],
  zoom: 4,
  geolocatedZoom: 13,
  style: 'mapbox://styles/mapbox/light-v11',
  debounceMs: 300,
}

export const CLUSTER_CONFIG = {
  clusterMaxZoom: 14,
  clusterRadius: 50,
}

export const PIN_COLORS: Record<OwnershipTier, { hex: string; name: string }> = {
  coop: { hex: '#0E6B2E', name: 'deep-green' },
  independent: { hex: '#1B7A3D', name: 'green' },
  'mission-driven': { hex: '#5A8F66', name: 'sage' },
  'local-franchise': { hex: '#97A89A', name: 'gray-green' },
  challenger: { hex: '#B0B0B0', name: 'light-gray' },
  'pe-corporate': { hex: '#2A2A2A', name: 'near-black' },
}
