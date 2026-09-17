// Region taxonomy for SOV anonymization (Plan-it-2 §5.2 / §9 Q3).
// Kept deliberately small for this iteration: US (broken out by state),
// Japan, and China. Perils are a general, cross-region list.

export const PERILS = ['Wind', 'Fire', 'EQ', 'Flood']

// A representative set of cat-exposed US states rather than all 50 — kept
// to the states that actually carry meaningful nat cat weight in an SOV,
// plus an "Other US" catch-all bucket.
export const US_STATES = [
  'FL', 'CA', 'TX', 'LA', 'NY', 'SC', 'NC', 'GA', 'NJ', 'MA', 'Other US',
]

export const REGIONS = {
  US: { label: 'United States', states: US_STATES, perils: PERILS },
  JP: { label: 'Japan', perils: ['EQ', 'Wind'] },
  China: { label: 'China', perils: PERILS },
}
