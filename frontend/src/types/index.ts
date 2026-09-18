// TheroBird v3 — TypeScript Types
// Only types that are actually imported/used by active code live here.

// ── Auth ────────────────────────────────────────────────────────────────

export interface User {
  id: number
  email: string
  full_name?: string
  organization?: string
  is_active: boolean
  is_verified: boolean
}

export interface TokenResponse {
  access_token: string
  refresh_token?: string
  token_type: string
  expires_in: number
}

// ── Cycle type ───────────────────────────────────────────────────────────
// Must match the engine's dispatcher keys exactly.

export type CycleType =
  | 'rankine'
  | 'orc'
  | 'brayton'
  | 'vapor_compression'
  | 'vapor_absorption'
  | 'custom'   // fallback — engine will infer from components
