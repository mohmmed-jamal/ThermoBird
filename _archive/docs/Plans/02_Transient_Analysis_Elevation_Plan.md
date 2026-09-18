# Plan 02 — Transient Analysis Elevation Strategy (Research-Enhanced)

> **Goal:** Elevate ThermoBird's transient analysis to world-class status, rivaling ANSYS Thermal, Modelica/Dymola, Simulink/Simscape, and GT-SUITE — while maintaining the unique advantage of being web-first, free, and accessible.

---

## 1  Industry Landscape & Competitive Analysis

### 1.1  Top-Tier Tools Comparison

| Capability | ANSYS | Modelica/Dymola | Simulink | GT-SUITE | Flownex | ThermoBird Target |
|------------|:-----:|:---------------:|:--------:|:--------:|:-------:|:-----------------:|
| **Multiple working fluids** | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ 120+ via CoolProp |
| **Arbitrary topologies** | ✓ | ✓ | ✓ | ✓ | ✓ | 🎯 **Target** |
| **Dynamic component coupling** | ✓ | ✓ | ✓ | ✓ | ✓ | 🎯 **Critical** |
| **Multiple solver methods** | ✓ | ✓ | ✓ | ✓ | ✓ | 🎯 **Critical** |
| **Event detection** | ✓ | ✓ | ✓ | ✓ | ✓ | 🎯 **High** |
| **PID/Control systems** | — | ✓ | ✓ | ✓ | ✓ | 🎯 **High** |
| **Real-time streaming** | — | — | ✓ | ✓ | ✓ | 🎯 **High** |
| **First+Second law combined** | — | — | — | — | — | ✓ **UNIQUE** |
| **Exergy destruction tracking** | Partial | — | — | — | — | ✓ **UNIQUE** |
| **Web-based / No install** | — | — | — | — | — | ✓ **UNIQUE** |
| **Free for education** | — | — | — | — | — | ✓ **UNIQUE** |

### 1.2  Market Pain Points (Research Synthesis)

**From User Research:**
1. **Convergence failures** are the #1 blocker in transient simulation
2. **High costs** ($15K-€100K licenses) prevent student/researcher access
3. **Steep learning curves** — months to proficiency in Dymola/Simulink
4. **No real-time feedback** — wait minutes/hours to discover errors
5. **Static component coupling** — manual parameter passing between components
6. **Limited educational focus** — professional tools ignore pedagogy

**ThermoBird's Opportunity:**
- Only tool combining **professional-grade accuracy** with **educational accessibility**
- Only web-based tool with **real-time exergy analysis**
- Potential to become the **"Figma of thermodynamics"**

---

## 2  Technical Architecture Vision

### 2.1  Core Solver Enhancement

#### Multi-Method Solver Framework

```python
# core/transient/solver_framework.py

class AdaptiveSolver:
    """
    Intelligent solver selection based on system characteristics.
    """
    SOLVERS = {
        'RK45': {
            'method': 'RK45',
            'stiff': False,
            'best_for': 'Non-stiff systems, fast transients',
            'use_when': 'all_eigenvalues_negative_and_small'
        },
        'Radau': {
            'method': 'Radau',
            'stiff': True,
            'order': 5,
            'best_for': 'Stiff systems, chemical kinetics',
            'use_when': 'stiffness_ratio > 1000'
        },
        'BDF': {
            'method': 'BDF',
            'stiff': True,
            'best_for': 'Very stiff, large systems',
            'use_when': 'extreme_stiffness or dae_index > 1'
        },
        'LSODA': {
            'method': 'LSODA',
            'stiff': 'Auto-detect',
            'best_for': 'Unknown stiffness, general purpose',
            'use_when': 'default, adaptive'
        },
        'DOP853': {
            'method': 'DOP853',
            'stiff': False,
            'order': 8,
            'best_for': 'High accuracy, smooth problems',
            'use_when': 'high_precision_required'
        }
    }
    
    def auto_select(self, system_analysis: SystemAnalysis) -> str:
        """Automatically select best solver based on system characteristics."""
        if system_analysis.stiffness_ratio > 10000:
            return 'BDF'
        elif system_analysis.stiffness_ratio > 100:
            return 'Radau'
        elif system_analysis.required_precision < 1e-8:
            return 'DOP853'
        else:
            return 'LSODA'  # Safe default
```

#### Event Detection System

```python
# core/transient/event_detection.py

class EventDetector:
    """
    Detect and handle discrete events during transient simulation.
    """
    EVENT_TYPES = {
        'phase_change': {
            'detection': 'zero_crossing',
            'condition': 'T_sat - T_fluid',
            'action': 'adjust_heat_transfer_model'
        },
        'overspeed_trip': {
            'detection': 'threshold_crossing',
            'condition': 'omega > 1.1 * omega_rated',
            'action': 'trip_turbine'
        },
        'thermal_equilibrium': {
            'detection': 'derivative_threshold',
            'condition': 'all(abs(dT/dt) < epsilon)',
            'action': 'terminate_simulation'
        },
        'pressure_limit': {
            'detection': 'threshold_crossing',
            'condition': 'P > P_max',
            'action': 'open_relief_valve'
        }
    }
    
    def create_events(self, config: dict) -> list[Callable]:
        """Create scipy-compatible event functions."""
        events = []
        for event_config in config.get('events', []):
            event_fn = self._build_event_function(event_config)
            event_fn.terminal = event_config.get('terminal', False)
            event_fn.direction = event_config.get('direction', 0)
            events.append(event_fn)
        return events
```

### 2.2  Dynamic Component Coupling (CRITICAL)

**Current Problem:** Components are isolated — boiler outlet doesn't automatically become turbine inlet.

**Solution: Connection Graph with Live Property Passing**

```python
# core/transient/coupling.py

@dataclass
class Connection:
    """Defines a connection between two component ports."""
    source: str          # Component name
    source_port: str     # e.g., "outlet"
    target: str          # Component name
    target_port: str     # e.g., "inlet"
    properties: list[str]  # e.g., ["h", "P", "T", "m_dot"]

class ComponentGraph:
    """
    Manages dynamic coupling between components.
    At each timestep, outlet properties are computed and passed to inlets.
    """
    
    def __init__(self):
        self.components: dict[str, ComponentModel] = {}
        self.connections: list[Connection] = []
        self.property_cache: dict[str, dict] = {}
    
    def add_connection(self, conn: Connection):
        """Add a connection between components."""
        self.connections.append(conn)
    
    def update_coupling(self, t: float, y: np.ndarray, fluid: str):
        """
        Compute outlet properties from all components,
        then update inlet parameters for connected components.
        """
        # Phase 1: Compute outlet properties for all components
        for name, model in self.components.items():
            outlet_props = model.compute_outlet_properties(t, y, fluid)
            self.property_cache[name] = outlet_props
        
        # Phase 2: Pass properties across connections
        for conn in self.connections:
            source_props = self.property_cache[conn.source]
            target_model = self.components[conn.target]
            
            for prop in conn.properties:
                if prop in source_props:
                    target_model.set_inlet_parameter(
                        conn.target_port, prop, source_props[prop]
                    )
    
    def build_ode_function(self) -> Callable:
        """Build the coupled ODE system."""
        def dydt(t: float, y: np.ndarray) -> np.ndarray:
            # Update couplings before computing derivatives
            self.update_coupling(t, y, self.fluid)
            
            # Compute derivatives for all components
            derivatives = []
            for name, model in self.components.items():
                dydt_component = model.dydt(t, y, self.fluid)
                derivatives.extend(dydt_component)
            
            return np.array(derivatives)
        
        return dydt
```

### 2.3  Expanded Component Library

| Component | State Variables | Physics Model | Priority |
|-----------|-----------------|---------------|----------|
| **Boiler** (existing) | T_fluid, T_wall | Two-node thermal inertia | ✓ Done |
| **Turbine** (enhanced) | ω (speed), T_out | Inertia + quasi-steady | 🔴 Critical |
| **Condenser** (existing) | T_fluid | Single-node | ✓ Done |
| **Pump** (enhanced) | ω or constant | Volumetric + efficiency | 🟡 High |
| **Gas Turbine** (Brayton) | ω, T_combustor | Compressor + combustor + turbine | 🟡 High |
| **Recuperator** | T_hot_out, T_cold_out | NTU-ε counterflow | 🟡 High |
| **Throttle Valve** | — (algebraic) | Isenthalpic flash | 🟢 Medium |
| **Evaporator** | T_fluid_evap | Two-phase heat transfer | 🟢 Medium |
| **Heat Exchanger (generic)** | T_primary, T_secondary | LMTD or NTU-ε | 🟢 Medium |
| **Generator/Load** | ω (coupled) | Electrical load model | 🟢 Medium |
| **Control Valve** | position | Variable area | 🔵 Low |

### 2.4  Control System Integration

```python
# core/transient/controllers.py

@dataclass
class PIDController:
    """Industrial PID controller with anti-windup."""
    Kp: float
    Ki: float
    Kd: float
    setpoint: float
    
    # Limits
    output_min: float = -float('inf')
    output_max: float = float('inf')
    
    # Anti-windup
    integrator_limit: float = float('inf')
    
    # State
    integral: float = 0.0
    last_error: float = 0.0
    last_time: float = 0.0
    
    def update(self, measurement: float, t: float) -> float:
        """Compute control output."""
        dt = t - self.last_time
        error = self.setpoint - measurement
        
        # Proportional
        P = self.Kp * error
        
        # Integral with anti-windup
        self.integral += error * dt
        self.integral = np.clip(self.integral, -self.integrator_limit, self.integrator_limit)
        I = self.Ki * self.integral
        
        # Derivative (on measurement, not error, for smoother response)
        d_measurement = (measurement - self.last_measurement) / dt if dt > 0 else 0
        D = -self.Kd * d_measurement  # Negative for derivative on measurement
        
        # Compute output
        output = P + I + D
        
        # Clamp and back-calculate for anti-windup
        output_clamped = np.clip(output, self.output_min, self.output_max)
        if output != output_clamped:
            # Back-calculate integral to prevent windup
            self.integral = (output_clamped - P - D) / self.Ki if self.Ki != 0 else 0
        
        # Update state
        self.last_error = error
        self.last_time = t
        self.last_measurement = measurement
        
        return output_clamped

# Advanced controllers
class MPCController:
    """Model Predictive Control for MIMO systems."""
    pass

class FuzzyController:
    """Fuzzy logic controller for nonlinear systems."""
    pass
```

---

## 3  TBS Script Language Expansion

### 3.1  New Syntax Keywords

```python
# Example TBS v3 script with all new features

# ── Working fluid ─────────────────────────────────────────────────────────────
fluid = "Water"

# ── Component instantiation ───────────────────────────────────────────────────
component boiler {
    type = "HeatExchanger"
    wall_mass = 200        # kg
    fluid_mass = 80        # kg
    UA_source = 5000       # W/K
    UA_fluid_wall = 2000   # W/K
}

component turbine {
    type = "Turbine"
    rotor_inertia = 500    # kg·m²
    eta_isentropic = 0.85
}

component condenser {
    type = "HeatExchanger"
    UA_condenser = 3000    # W/K
    T_sink = 298.15        # K
}

component pump {
    type = "Pump"
    eta_isentropic = 0.80
}

# ── Topology definition (CRITICAL) ───────────────────────────────────────────
connect boiler.outlet → turbine.inlet
connect turbine.outlet → condenser.inlet
connect condenser.outlet → pump.inlet
connect pump.outlet → boiler.inlet

# ── State variables ───────────────────────────────────────────────────────────
state T_fluid_boiler = 320      # K
state T_wall_boiler = 330       # K
state omega_turbine = 0         # rad/s (startup from rest)
state T_fluid_condenser = 310   # K

# ── ODE definitions ───────────────────────────────────────────────────────────
dT_fluid_boiler/dt = (UA_fw * (T_wall - T_f) - m_dot * (h_out - h_in)) / (m_fluid * cp_f)
dT_wall_boiler/dt = (UA_src * (T_source - T_wall) - UA_fw * (T_wall - T_f)) / (m_wall * cp_wall)
domega_turbine/dt = (tau_turbine - tau_load) / I_rotor

# ── Controller definition ─────────────────────────────────────────────────────
controller boiler_pid {
    type = "PID"
    setpoint = 873.15       # K (600°C)
    measurement = T_fluid_boiler
    output = Q_dot_boiler
    Kp = 1.5
    Ki = 0.2
    Kd = 0.05
    output_min = 0          # kW
    output_max = 10000      # kW
}

# ── Event definitions ─────────────────────────────────────────────────────────
event boiler_superheat {
    condition = "T_fluid_boiler > T_sat(P_boiler)"
    action = "log('Boiler now superheated')"
}

event turbine_overspeed {
    condition = "omega_turbine > 350"
    action = "trip_turbine()"
    terminal = true         # Stop simulation
}

event steady_state {
    condition = "abs(dT_fluid_boiler/dt) < 0.01 AND abs(domega_turbine/dt) < 0.001"
    action = "log('Steady state reached')"
}

# ── Solver configuration ──────────────────────────────────────────────────────
solver {
    method = "auto"         # Auto-select based on stiffness
    # Options: "RK45", "Radau", "BDF", "LSODA", "DOP853"
    
    t_end = 600             # s
    t_steps = 500
    
    rtol = 1e-4
    atol = 1e-6
    
    max_step = 1.0          # Maximum timestep [s]
    min_step = 1e-6         # Minimum timestep [s]
    
    dense_output = true     # Enable interpolation between steps
}

# ── Output specification ──────────────────────────────────────────────────────
output {
    variables = ["T_fluid_boiler", "omega_turbine", "eta_thermal", "X_dest_total"]
    format = "csv"          # csv, json, hdf5
    save_interval = 1.0     # s
}
```

---

## 4  Frontend Enhancements

### 4.1  Visual Topology Builder

```
┌─────────────────────────────────────────────────────────────────────────┐
│ Transient Configuration                                     [⚙️] [?]   │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌──────────────┐        ┌──────────┐        ┌──────────────┐          │
│  │              │        │          │        │              │          │
│  │    🔥        │───────→│   💨     │───────→│     💧       │          │
│  │   Boiler     │  steam │ Turbine  │ exhaust│  Condenser   │          │
│  │              │        │          │        │              │          │
│  │  3 MPa       │        │  85% η   │        │  10 kPa      │          │
│  │  500°C target│        │          │        │              │          │
│  └──────────────┘        └────┬─────┘        └──────┬───────┘          │
│       ↑                       │                     │                   │
│       │                       │                     │                   │
│       └───────────────────────┴─────────────────────┘                   │
│                          feedwater                                     │
│                    ┌──────────┐                                         │
│                    │   ⚙️     │                                         │
│                    │   Pump   │                                         │
│                    └──────────┘                                         │
│                                                                         │
│  [+ Add Component]  [💾 Save Template]  [📤 Load Template]             │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │ Selected: Turbine                                          [✕] │   │
│  │ ────────────────────────────────────────────────────────────────│   │
│  │  Isentropic efficiency [0.85   ]                               │   │
│  │  Rotor inertia         [500    ] kg·m²                         │   │
│  │  Inlet pressure        [3.0e6  ] Pa  ← from Boiler outlet      │   │
│  │  Outlet pressure       [10000  ] Pa  ← to Condenser inlet      │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

**Features:**
1. **Drag-and-drop canvas** for component placement
2. **Visual connections** showing flow paths
3. **Live property passing indicators** — see which properties flow where
4. **Component property panel** — edit selected component
5. **Template save/load** — save common configurations
6. **Validation indicators** — red warnings for incomplete connections

### 4.2  Real-Time Results Streaming

Replace polling with WebSocket/SSE for live updates:

```typescript
// useTransientStream.ts
export function useTransientStream() {
  const [progress, setProgress] = useState(0);
  const [partialData, setPartialData] = useState<TransientData>([]);
  const [isConnected, setIsConnected] = useState(false);

  const startStream = useCallback((jobId: string) => {
    const es = new EventSource(`/api/v1/transient/${jobId}/stream`);
    
    es.addEventListener('progress', (e) => {
      const data = JSON.parse(e.data);
      setProgress(data.progress);
    });
    
    es.addEventListener('partial', (e) => {
      const data = JSON.parse(e.data);
      setPartialData(prev => [...prev, ...data.points]);
    });
    
    es.addEventListener('complete', (e) => {
      const result = JSON.parse(e.data);
      setResult(result);
      es.close();
    });
    
    es.onerror = () => {
      // Reconnect with exponential backoff
    };
    
    return () => es.close();
  }, []);

  return { startStream, progress, partialData, isConnected };
}
```

### 4.3  Advanced Chart Features

```
┌─────────────────────────────────────────────────────────────────────┐
│ Temperatures vs Time                                    [⚙️] [⬇️]  │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│   ┌─────────────────────────────────────────────────────────────┐  │
│   │  ╭──────────────────────────────────────────╮               │  │
│   │ ╱  Boiler fluid                             ╲              │  │
│   │╱                                               ╲             │  │
│   │                    ╭────────────────────────────╲            │  │
│   │                   ╱                               ╲        │  │
│   │                  ╱                                 ╲_____  │  │  ← Live line
│   │                 ╱                                        ╲ │  │    drawing
│   │  Wall temp     ╱                                          ╲│  │
│   │  ─────────────╱                                            │  │
│   │                                                            │  │
│   └─────────────────────────────────────────────────────────────┘  │
│       ▲                                                           │
│       │  [█ Phase change at t=120s]                               │
│       ▼                                                           │
│   [████████████████████████████████████████] ← Brush for zoom    │
│   0s                                          600s                 │
│                                                                     │
│   [🔍 Zoom] [↔️ Pan] [📊 Compare runs] [📍 Add marker]             │
│                                                                     │
│   ┌─────────────────────────────────────────────────────────────┐  │
│   │ 📊 Statistics (visible range):                              │  │
│   │    Max: 873.15 K  |  Min: 320.00 K  |  Mean: 720.42 K       │  │
│   └─────────────────────────────────────────────────────────────┘  │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

**Features:**
1. **Live line drawing** — watch curves grow in real-time
2. **Brush/zoom** — drag to select time ranges
3. **Phase change markers** — automatic detection and annotation
4. **Compare runs** — overlay multiple simulations
5. **Statistics panel** — min/max/mean for visible range
6. **Export options** — PNG, SVG, CSV, MATLAB

---

## 5  Validation & Verification Framework

### 5.1  Benchmark Test Suite

```python
# tests/benchmarks/test_transient_validation.py

class TransientValidationTests:
    """
    Validation suite against analytical solutions and literature.
    """
    
    def test_lumped_capacitance_cooling(self):
        """
        Test against analytical lumped capacitance solution.
        Biot number << 1, so T(t) = T_inf + (T_0 - T_inf) * exp(-t/τ)
        """
        # Setup simple cooling problem
        # Run transient
        # Compare against analytical solution
        # Assert error < 1%
        pass
    
    def test_rankine_steady_state(self):
        """
        Verify transient converges to known steady-state solution.
        Compare against Çengel & Boles Example 10-5.
        """
        pass
    
    def test_energy_conservation(self):
        """
        Total energy must be conserved (first law check).
        """
        pass
    
    def test_exergy_balance(self):
        """
        Exergy destruction must equal T0 * S_gen (Gouy-Stodola).
        """
        pass
    
    def test_coolprop_accuracy(self):
        """
        Verify property calculations against NIST REFPROP.
        """
        pass
```

### 5.2  Continuous Validation

| Test Type | Frequency | Purpose |
|-----------|-----------|---------|
| Unit tests | Every commit | Component model correctness |
| Integration tests | Every PR | Solver + components together |
| Benchmark tests | Nightly | Accuracy vs. literature |
| Performance tests | Weekly | Solver speed regression |
| Cross-code validation | Monthly | Compare with Dymola/Modelica |

---

## 6  Implementation Roadmap

### Phase 1 — Foundation (Weeks 1-2)
- [ ] Fix parameter name mapping (frontend ↔ backend)
- [ ] Extract shared `core/thermo.py` module
- [ ] Implement connection graph with basic coupling
- [ ] Add BDF and LSODA solver options

### Phase 2 — Component Expansion (Weeks 3-4)
- [ ] Enhanced Turbine model with dynamic coupling
- [ ] Gas Turbine (Brayton) component
- [ ] Recuperator/Regenerator component
- [ ] Generic Heat Exchanger with NTU-ε

### Phase 3 — Control Systems (Weeks 5-6)
- [ ] PID controller implementation
- [ ] Controller configuration in TBS
- [ ] Visual control loop builder
- [ ] Anti-windup and tuning helpers

### Phase 4 — Events & Intelligence (Weeks 7-8)
- [ ] Event detection framework
- [ ] Phase change detection
- [ ] Auto-termination on steady-state
- [ ] Solver auto-selection

### Phase 5 — Real-Time Features (Weeks 9-10)
- [ ] WebSocket/SSE streaming backend
- [ ] Live chart updates frontend
- [ ] Progress indicators with ETA
- [ ] Partial results display

### Phase 6 — UX Polish (Weeks 11-12)
- [ ] Visual topology builder
- [ ] Chart zoom/pan/compare
- [ ] Template save/load
- [ ] Export enhancements (PDF, MATLAB)

### Phase 7 — Validation (Weeks 13-14)
- [ ] Benchmark test suite
- [ ] Cross-code validation
- [ ] Documentation
- [ ] Example library

**Total Timeline: 14 weeks (3.5 months)**

---

## 7  Key Differentiators to Market

After full implementation, ThermoBird will be the **ONLY** tool offering:

1. **🌐 Web-first, no installation** — Run anywhere, instant access
2. **💰 Free for education** — Democratizing thermodynamic analysis
3. **⚡ Real-time first+second law** — Unique exergy tracking
4. **🎓 Educational scaffolding** — Built-in pedagogy, not just calculation
5. **🔄 Dynamic component coupling** — True system simulation
6. **📊 Live visualization** — Watch simulations unfold
7. **🧮 TBS scripting** — Domain-specific language for thermodynamics
8. **✅ Validated accuracy** — Against NIST and literature benchmarks

---

## 8  Success Metrics

| Metric | Current | 6-Month Target | 12-Month Target |
|--------|---------|----------------|-----------------|
| Supported fluids | 6 | 50 | 120+ (all CoolProp) |
| Component types | 4 | 8 | 15 |
| Solver methods | 1 | 4 | 6 |
| Simulation types | Rankine only | Rankine + Brayton | All cycles + custom |
| Max components/sim | 4 | 10 | Unlimited |
| Real-time updates | Polling (2s) | SSE streaming | WebSocket |
| Chart interactivity | Static | Zoom/pan | Full D3-like |
| Educational users | — | 1,000 | 10,000 |
