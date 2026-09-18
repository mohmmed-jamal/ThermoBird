// TheroBird — Component Library (keyed by type)

export interface PropertyInput {
  key:     string
  label:   string
  unit:    string
  step:    number
  min?:    number
  max?:    number
  hint?:   string
}

interface ComponentDef {
  label:         string
  icon:          string
  description:   string
  category:      'work' | 'heat' | 'flow'
  ports:         string[]
  defaultParams: Record<string, any>
  /** Thermodynamic governing equation shown in results */
  equation:      string
  /** Inlet / outlet condition inputs shown in the side panel */
  propertyInputs: PropertyInput[]
}

export const componentLibrary: Record<string, ComponentDef> = {

  turbine: {
    label:       'Turbine',
    icon:        '⚙️',
    description: 'Expands high-pressure fluid to produce shaft work.',
    category:    'work',
    ports:       ['inlet', 'outlet'],
    equation:    'ẇ_t = ṁ·η_is·(h_in − h_out,is)',
    defaultParams: { eta_isentropic: 0.85 },
    propertyInputs: [
      { key: 'eta_isentropic', label: 'Isentropic Efficiency', unit: '–',   step: 0.01, min: 0.1,   max: 1.0, hint: 'Ratio of actual to isentropic work output' },
      { key: 'inlet_P',        label: 'Inlet Pressure',        unit: 'kPa', step: 100,  min: 0.1,             hint: 'High-side pressure at turbine inlet' },
      { key: 'inlet_T',        label: 'Inlet Temperature',     unit: 'K',   step: 1,    min: 200,             hint: 'Temperature at turbine inlet' },
      { key: 'outlet_P',       label: 'Outlet Pressure',       unit: 'kPa', step: 10,   min: 0.1,             hint: 'Low-side pressure at turbine exit' },
    ],
  },

  pump: {
    label:       'Pump',
    icon:        '💧',
    description: 'Pressurises liquid, consuming shaft work.',
    category:    'work',
    ports:       ['inlet', 'outlet'],
    equation:    'ẇ_p = ṁ·(h_out − h_in) = ṁ·(h_out,is − h_in) / η_is',
    defaultParams: { eta_isentropic: 0.80 },
    propertyInputs: [
      { key: 'eta_isentropic', label: 'Isentropic Efficiency', unit: '–',   step: 0.01, min: 0.1, max: 1.0, hint: 'Ratio of isentropic to actual work input' },
      { key: 'inlet_P',        label: 'Inlet Pressure',        unit: 'kPa', step: 10,   min: 0.1,           hint: 'Suction-side pressure' },
      { key: 'outlet_P',       label: 'Outlet Pressure',       unit: 'kPa', step: 100,  min: 0.1,           hint: 'Discharge-side pressure' },
    ],
  },

  compressor: {
    label:       'Compressor',
    icon:        '🔧',
    description: 'Compresses gas, consuming shaft work.',
    category:    'work',
    ports:       ['inlet', 'outlet'],
    equation:    'ẇ_c = ṁ·(h_out,is − h_in) / η_is',
    defaultParams: { eta_isentropic: 0.80 },
    propertyInputs: [
      { key: 'eta_isentropic', label: 'Isentropic Efficiency', unit: '–',  step: 0.01, min: 0.1, max: 1.0,  hint: 'Ratio of isentropic to actual work input' },
      { key: 'inlet_T',        label: 'Inlet Temperature',     unit: 'K',   step: 1,   min: 200,  hint: 'Gas temperature at compressor inlet' },
      { key: 'inlet_P',        label: 'Inlet Pressure',        unit: 'kPa', step: 10,  min: 0.1,  hint: 'Compressor inlet pressure' },
      { key: 'pressure_ratio', label: 'Pressure Ratio',        unit: '–',   step: 0.5, min: 1.01, hint: 'P_outlet / P_inlet' },
    ],
  },

  boiler: {
    label:       'Boiler / Heat Source',
    icon:        '🔥',
    description: 'Adds heat to the working fluid at high pressure.',
    category:    'heat',
    ports:       ['inlet', 'outlet'],
    equation:    'Q̇_in = ṁ·(h_out − h_in)',
    defaultParams: { T_source: 1500 },
    propertyInputs: [
      { key: 'T_source', label: 'Heat Source Temperature', unit: 'K',   step: 10,  min: 300, hint: 'Temperature of external heat source (e.g. flue gas, combustion)' },
      { key: 'outlet_T', label: 'Outlet Temperature',      unit: 'K',   step: 1,   min: 200, hint: 'Target fluid temperature leaving the boiler' },
      { key: 'outlet_P', label: 'Operating Pressure',      unit: 'kPa', step: 100, min: 0.1, hint: 'Boiler operating pressure' },
    ],
  },

  condenser: {
    label:       'Condenser / Heat Sink',
    icon:        '❄️',
    description: 'Rejects heat and condenses vapour to liquid.',
    category:    'heat',
    ports:       ['inlet', 'outlet'],
    equation:    'Q̇_out = ṁ·(h_in − h_out)',
    defaultParams: { T_sink: 298.15, outlet_x: 0.0 },
    propertyInputs: [
      { key: 'T_sink',   label: 'Cooling Medium Temperature', unit: 'K',    step: 1,    min: 200,       hint: 'Temperature of the cooling water / air' },
      { key: 'outlet_x', label: 'Outlet Vapour Quality',      unit: '0–1',  step: 0.01, min: 0, max: 1, hint: '0 = saturated liquid; typically 0 for condensers' },
      { key: 'outlet_P', label: 'Condensing Pressure',        unit: 'kPa',  step: 10,   min: 0.1,       hint: 'Low-side saturation pressure' },
    ],
  },

  evaporator: {
    label:       'Evaporator',
    icon:        '🌡️',
    description: 'Evaporates the refrigerant by absorbing heat.',
    category:    'heat',
    ports:       ['inlet', 'outlet'],
    equation:    'Q̇_evap = ṁ·(h_out − h_in)',
    defaultParams: { T_source: 308.15, outlet_x: 1.0 },
    propertyInputs: [
      { key: 'T_source', label: 'Refrigerated Space Temperature', unit: 'K',    step: 1,    min: 150,       hint: 'Temperature of the space being cooled' },
      { key: 'outlet_x', label: 'Outlet Vapour Quality',           unit: '0–1',  step: 0.01, min: 0, max: 1, hint: '1.0 = saturated vapour at evaporator exit' },
      { key: 'outlet_P', label: 'Evaporating Pressure',            unit: 'kPa',  step: 10,   min: 0.1,       hint: 'Low-side saturation pressure' },
    ],
  },

  heat_exchanger: {
    label:       'Heat Exchanger',
    icon:        '🔄',
    description: 'Transfers heat between two fluid streams.',
    category:    'heat',
    ports:       ['hot_inlet', 'hot_outlet', 'cold_inlet', 'cold_outlet'],
    equation:    'ε = Q̇_actual / Q̇_max  ;  Q̇ = ε·Ċ_min·(T_hot,in − T_cold,in)',
    defaultParams: { effectiveness: 0.80 },
    propertyInputs: [
      { key: 'effectiveness', label: 'Effectiveness ε',        unit: '–',   step: 0.01, min: 0.01, max: 1.0, hint: 'Ratio of actual to maximum possible heat transfer' },
      { key: 'T_hot_in',      label: 'Hot-Side Inlet Temp',    unit: 'K',   step: 1,    min: 200,            hint: 'Hot stream inlet temperature' },
      { key: 'T_cold_in',     label: 'Cold-Side Inlet Temp',   unit: 'K',   step: 1,    min: 100,            hint: 'Cold stream inlet temperature' },
      { key: 'P_hot',         label: 'Hot-Side Pressure',      unit: 'kPa', step: 100,  min: 0.1,            hint: 'Hot stream operating pressure' },
      { key: 'P_cold',        label: 'Cold-Side Pressure',     unit: 'kPa', step: 100,  min: 0.1,            hint: 'Cold stream operating pressure' },
    ],
  },

  expansion_valve: {
    label:       'Expansion Valve',
    icon:        '🔽',
    description: 'Isenthalpic pressure drop — h_in = h_out.',
    category:    'flow',
    ports:       ['inlet', 'outlet'],
    equation:    'h_out = h_in  (Δh = 0,  Δs > 0)',
    defaultParams: {},
    propertyInputs: [
      { key: 'inlet_P',  label: 'Inlet Pressure (High Side)',  unit: 'kPa', step: 100, min: 0.1, hint: 'High-pressure liquid entering the valve' },
      { key: 'outlet_P', label: 'Outlet Pressure (Low Side)',  unit: 'kPa', step: 10,  min: 0.1, hint: 'Low-pressure two-phase mixture leaving the valve' },
      { key: 'inlet_T',  label: 'Inlet Temperature',           unit: 'K',   step: 1,   min: 150, hint: 'Subcooled liquid temperature before expansion' },
    ],
  },

  regenerator: {
    label:       'Regenerator',
    icon:        '♻️',
    description: 'Closed heat exchanger — hot stream pre-heats cold stream (no mixing).',
    category:    'heat',
    ports:       ['hot_inlet', 'hot_outlet', 'cold_inlet', 'cold_outlet'],
    equation:    'ε = Q̇_actual / Q̇_max  ;  Q̇_max = Ċ_min·(T_hot,in − T_cold,in)',
    defaultParams: { effectiveness: 0.85, pressure_drop_hot: 0, pressure_drop_cold: 0 },
    propertyInputs: [
      { key: 'effectiveness',      label: 'Effectiveness ε',         unit: '–',   step: 0.01, min: 0.01, max: 1.0, hint: 'Ratio of actual to maximum possible heat recovery' },
      { key: 'pressure_drop_hot',  label: 'Hot-Side Pressure Drop',  unit: 'kPa', step: 1,    min: 0,           hint: 'Pressure loss on the hot stream side' },
      { key: 'pressure_drop_cold', label: 'Cold-Side Pressure Drop', unit: 'kPa', step: 1,    min: 0,           hint: 'Pressure loss on the cold stream side' },
    ],
  },

  mixing_chamber: {
    label:       'Mixing Chamber',
    icon:        '🔀',
    description: 'Adiabatic open mixer — 2 inlets, 1 outlet (open feedwater heater).',
    category:    'heat',
    ports:       ['inlet_1', 'inlet_2', 'outlet'],
    equation:    'ṁ₁h₁ + ṁ₂h₂ = (ṁ₁+ṁ₂)·h_out  ;  adiabatic',
    defaultParams: { pressure_drop: 0 },
    propertyInputs: [
      { key: 'pressure_drop',   label: 'Pressure Drop',          unit: 'kPa',  step: 1,    min: 0,           hint: 'Optional frictional pressure drop at outlet' },
      { key: 'outlet_quality',  label: 'Forced Outlet Quality x', unit: '0–1', step: 0.01, min: 0, max: 1,  hint: 'Leave blank to compute from energy balance; set 0 for sat. liquid' },
      { key: 'mass_flow_1',     label: 'Inlet 1 Mass Flow',      unit: 'kg/s', step: 0.1, min: 0,           hint: 'Mass flow entering from inlet 1 (e.g. bleed steam)' },
      { key: 'mass_flow_2',     label: 'Inlet 2 Mass Flow',      unit: 'kg/s', step: 0.1, min: 0,           hint: 'Mass flow entering from inlet 2 (e.g. feed water)' },
    ],
  },
}

export const CATEGORY_LABELS = {
  work: 'Work Devices',
  heat: 'Heat Transfer',
  flow: 'Flow Control',
}
