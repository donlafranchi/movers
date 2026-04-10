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
  independent: { hex: '#D4A017', name: 'gold' },
  coop: { hex: '#1B7A3D', name: 'green' },
  'local-franchise': { hex: '#E8A317', name: 'amber' },
  challenger: { hex: '#2196F3', name: 'blue' },
  'mission-driven': { hex: '#9C27B0', name: 'purple' },
  'pe-corporate': { hex: '#9E9E9E', name: 'grey' },
}
