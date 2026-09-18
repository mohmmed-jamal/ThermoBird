/**
 * canvasTemplates.ts — pre-wired cycle templates for "Load Template" feature.
 * Each template produces a valid useCycleStore payload (components + connections).
 */

export interface TemplateComponent {
  id:         string;
  type:       string;
  x:          number;
  y:          number;
  params:     Record<string, number | string>;
}

export interface TemplateConnection {
  id:     string;
  fromId: string;
  fromPort: string;
  toId:   string;
  toPort: string;
}

export interface CycleTemplate {
  id:          string;
  name:        string;
  description: string;
  icon:        string;
  cycleType:   'power' | 'refrigeration' | 'heat_pump';
  fluid:       string;
  massFlowRate: number;
  deadStateT0: number;
  deadStateP0: number;
  components:  TemplateComponent[];
  connections: TemplateConnection[];
  notes:       string;
}

// ── 1. Simple Rankine Power Cycle ────────────────────────────────────────────
export const RANKINE_TEMPLATE: CycleTemplate = {
  id:          'simple_rankine',
  name:        'Simple Rankine Cycle',
  description: 'Classic steam power cycle: Pump → Boiler → Turbine → Condenser',
  icon:        '⚡',
  cycleType:   'power',
  fluid:       'Water',
  massFlowRate: 1.0,
  deadStateT0: 298.15,
  deadStateP0: 101.325,
  notes: 'Boiler @ 3 MPa / 400 °C · Condenser @ 10 kPa · η_turbine = 0.85 · η_pump = 0.80',
  components: [
    {
      id: 'pump_1', type: 'pump',
      x: 200, y: 400,
      params: { eta_isentropic: 0.80, inlet_P: 10, outlet_P: 3000 },
    },
    {
      id: 'boiler_1', type: 'boiler',
      x: 200, y: 180,
      params: { T_source: 1200, outlet_T: 673.15, outlet_P: 3000 },
    },
    {
      id: 'turbine_1', type: 'turbine',
      x: 550, y: 180,
      params: { eta_isentropic: 0.85, inlet_P: 3000, inlet_T: 673.15, outlet_P: 10 },
    },
    {
      id: 'condenser_1', type: 'condenser',
      x: 550, y: 400,
      params: { T_sink: 298.15, outlet_x: 0.0, outlet_P: 10 },
    },
  ],
  connections: [
    { id: 'c1', fromId: 'pump_1',      fromPort: 'outlet', toId: 'boiler_1',    toPort: 'inlet'  },
    { id: 'c2', fromId: 'boiler_1',    fromPort: 'outlet', toId: 'turbine_1',   toPort: 'inlet'  },
    { id: 'c3', fromId: 'turbine_1',   fromPort: 'outlet', toId: 'condenser_1', toPort: 'inlet'  },
    { id: 'c4', fromId: 'condenser_1', fromPort: 'outlet', toId: 'pump_1',      toPort: 'inlet'  },
  ],
};

// ── 2. Vapour Compression Refrigeration Cycle ────────────────────────────────
export const VCR_TEMPLATE: CycleTemplate = {
  id:          'vcr',
  name:        'Vapour Compression Refrigeration',
  description: 'Standard VCR cycle: Compressor → Condenser → Expansion Valve → Evaporator',
  icon:        '❄️',
  cycleType:   'refrigeration',
  fluid:       'R134a',
  massFlowRate: 0.05,
  deadStateT0: 298.15,
  deadStateP0: 101.325,
  notes: 'R134a · Evaporating @ 200 kPa · Condensing @ 1200 kPa · η_compressor = 0.80',
  components: [
    {
      id: 'compressor_1', type: 'compressor',
      x: 200, y: 400,
      params: { eta_isentropic: 0.80, inlet_T: 253.15, inlet_P: 200, pressure_ratio: 6 },
    },
    {
      id: 'condenser_1', type: 'condenser',
      x: 200, y: 180,
      params: { T_sink: 298.15, outlet_x: 0.0, outlet_P: 1200 },
    },
    {
      id: 'valve_1', type: 'expansion_valve',
      x: 550, y: 180,
      params: { inlet_P: 1200, outlet_P: 200, inlet_T: 303.15 },
    },
    {
      id: 'evaporator_1', type: 'evaporator',
      x: 550, y: 400,
      params: { T_source: 263.15, outlet_x: 1.0, outlet_P: 200 },
    },
  ],
  connections: [
    { id: 'c1', fromId: 'compressor_1', fromPort: 'outlet', toId: 'condenser_1',  toPort: 'inlet'  },
    { id: 'c2', fromId: 'condenser_1',  fromPort: 'outlet', toId: 'valve_1',      toPort: 'inlet'  },
    { id: 'c3', fromId: 'valve_1',      fromPort: 'outlet', toId: 'evaporator_1', toPort: 'inlet'  },
    { id: 'c4', fromId: 'evaporator_1', fromPort: 'outlet', toId: 'compressor_1', toPort: 'inlet'  },
  ],
};

export const ALL_TEMPLATES: CycleTemplate[] = [RANKINE_TEMPLATE, VCR_TEMPLATE];
