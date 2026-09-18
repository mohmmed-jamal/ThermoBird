"""
Unified Simulation Engine - Handles Steady-State, Transient, and Parametric
"""

import time
import numpy as np
from typing import List, Dict, Any, Optional, Tuple
from dataclasses import dataclass, asdict
from scipy.integrate import solve_ivp
import CoolProp.CoolProp as CP

from .types import (
    SimulationConfig, SimulationResult, SimulationMode,
    TimePointResult, ComponentState
)
from .components.registry import (
    get_component_model, get_default_params,
    get_default_initial_conditions, requires_transient_model
)
from .analysis.topology import TopologyAnalyzer, CycleType as AnalysisCycleType
from .odes.heat_exchangers import (
    boiler_ode, condenser_ode, evaporator_ode, heater_ode, cooler_ode
)
from .odes.work_devices import turbine_ode, compressor_ode, pump_ode


class SimulationEngine:
    """
    Main simulation engine that handles:
    - Steady-state cycle analysis
    - Transient ODE integration
    - Parametric sweeps
    """
    
    def __init__(self):
        self.ode_registry = {
            'boiler': boiler_ode,
            'condenser': condenser_ode,
            'evaporator': evaporator_ode,
            'heater': heater_ode,
            'cooler': cooler_ode,
            'turbine': turbine_ode,
            'compressor': compressor_ode,
            'pump': pump_ode,
        }
        self._analyzer: Optional[TopologyAnalyzer] = None
    
    def run(self, config: SimulationConfig) -> SimulationResult:
        """Run simulation based on configuration"""
        t_start = time.time()
        
        # Analyze topology — keep reference so _solve_* can call analyzer methods
        self._analyzer = TopologyAnalyzer(config.components, config.connections)
        topology = self._analyzer.analyze()
        
        # Route to appropriate solver
        if config.mode == SimulationMode.STEADY_STATE:
            result = self._solve_steady_state(config, topology)
        elif config.mode == SimulationMode.TRANSIENT:
            result = self._solve_transient(config, topology)
        elif config.mode == SimulationMode.PARAMETRIC:
            result = self._solve_parametric(config, topology)
        else:
            return self._error_result(f"Unknown simulation mode: {config.mode}")
        
        # Add metadata
        result.execution_time_ms = int((time.time() - t_start) * 1000)
        result.cycle_type = topology.cycle_type.value
        
        return result
    
    def _solve_steady_state(
        self, 
        config: SimulationConfig, 
        topology: Any
    ) -> SimulationResult:
        """Solve steady-state cycle"""
        # Simplified steady-state solver
        # In reality, this would use sequential modular or equation-based approach
        
        try:
            # Build state point table
            state_points = []
            component_results = {}
            
            # Calculate component by component
            # KEY FIX: get_component_order lives on the ANALYZER, not the topology dataclass
            comp_map = {c.id: c for c in topology.components}
            for comp_id in self._analyzer.get_component_order():
                comp_obj = comp_map.get(comp_id)
                if not comp_obj:
                    continue

                # Simplified steady-state calculation
                comp_result = self._calculate_component_steady_state(
                    comp_obj, config.fluid, config
                )
                component_results[comp_id] = comp_result
            
            # Calculate global metrics
            W_net = sum(
                r.get('W_dot', 0) for r in component_results.values()
            )
            Q_in = sum(
                r.get('Q_in', 0) for r in component_results.values() if r.get('Q_in', 0) > 0
            )
            
            eta_thermal = W_net / Q_in if Q_in > 0 else 0
            
            # Build result
            steady_state = TimePointResult(
                t=0,
                component_states={},  # Would populate from component_results
                W_net=W_net,
                Q_in=Q_in,
                eta_thermal=eta_thermal,
                eta_carnot=1 - config.T0 / 900,  # Simplified
            )
            
            return SimulationResult(
                success=True,
                mode=SimulationMode.STEADY_STATE,
                cycle_type=topology.cycle_type.value,
                steady_state=steady_state,
                component_results=component_results,
            )
            
        except Exception as e:
            return self._error_result(f"Steady-state solver failed: {str(e)}")
    
    def _solve_transient(
        self, 
        config: SimulationConfig, 
        topology: Any
    ) -> SimulationResult:
        """Solve transient ODE system"""
        try:
            # Build ODE system
            components_with_odes = []
            y0 = []
            state_var_map = []
            
            for comp in topology.components.values():
                if not requires_transient_model(comp.type):
                    continue
                
                model = get_component_model(comp.type)
                if not model or not model['odes']:
                    continue
                
                # Get initial conditions
                ics = get_default_initial_conditions(comp.type)
                # Override with canvas state if available
                ics.update(comp.parameters.get('initial_state', {}))
                
                # Get state variable order
                state_vars = model['state_vars']
                
                # Build initial state vector
                comp_y0 = [ics.get(sv, 300.0) for sv in state_vars]
                
                y0.extend(comp_y0)
                
                components_with_odes.append({
                    'id': comp.id,
                    'type': comp.type,
                    'params': {**get_default_params(comp.type), **comp.parameters},
                    'state_vars': state_vars,
                    'offset': len(y0) - len(comp_y0),
                    'length': len(comp_y0)
                })
                
                # Build state variable mapping
                for i, sv in enumerate(state_vars):
                    state_var_map.append({
                        'component_id': comp.id,
                        'variable': sv,
                        'index': len(y0) - len(comp_y0) + i
                    })
            
            if not components_with_odes:
                return self._error_result("No components with transient models")
            
            y0 = np.clip(np.array(y0, dtype=float), 273.15, 1200.0)
            
            # Build ODE function
            def ode_system(t: float, y: np.ndarray) -> np.ndarray:
                """Full ODE system"""
                dy = np.zeros_like(y)
                
                for comp in components_with_odes:
                    # Extract component state
                    yi = y[comp['offset']:comp['offset'] + comp['length']]
                    
                    # Get ODE function
                    ode_func = self.ode_registry.get(comp['type'])
                    if not ode_func:
                        continue
                    
                    # Get inlet conditions from upstream
                    inlet_state = self._get_inlet_state(
                        comp['id'], topology, y, state_var_map
                    )
                    
                    # Calculate derivatives
                    try:
                        dyi = ode_func(t, yi, comp['params'], config.fluid, inlet_state)
                        dy[comp['offset']:comp['offset'] + comp['length']] = dyi
                    except Exception as e:
                        # Zero derivatives on failure
                        pass
                
                return dy
            
            # Solve ODE
            t_span = [0, config.t_end]
            t_eval = np.linspace(0, config.t_end, config.t_steps)
            
            # Auto-select solver
            method = config.solver_method
            if method == 'Auto':
                method = self._auto_select_solver(components_with_odes)
            
            sol = solve_ivp(
                ode_system,
                t_span,
                y0,
                method=method,
                t_eval=t_eval,
                rtol=config.rtol,
                atol=config.atol,
                max_step=min(config.t_end / 100.0, 5.0),
            )
            
            # Build time series results
            time_points = []
            for i, t in enumerate(sol.t):
                y = sol.y[:, i]
                
                tp = TimePointResult(
                    t=t,
                    component_states=self._extract_component_states(
                        y, components_with_odes
                    ),
                    W_net=0,  # Would calculate from component states
                    Q_in=0,
                    eta_thermal=0
                )
                
                time_points.append(tp)
            
            # Build state points table (from final state)
            state_points = self._build_state_points_table(
                topology, time_points[-1] if time_points else None
            )
            
            return SimulationResult(
                success=sol.success,
                mode=SimulationMode.TRANSIENT,
                cycle_type=topology.cycle_type.value,
                time=sol.t.tolist(),
                time_points=time_points,
                state_points=state_points,
                metadata={
                    'solver_method': method,
                    'solver_nfev': int(sol.nfev),
                    'solver_message': sol.message
                },
                solver_nfev=int(sol.nfev)
            )
            
        except Exception as e:
            return self._error_result(f"Transient solver failed: {str(e)}")
    
    def _solve_parametric(
        self, 
        config: SimulationConfig, 
        topology: Any
    ) -> SimulationResult:
        """Solve parametric sweep"""
        # Would implement parametric sweep
        return self._error_result("Parametric solver not yet implemented")
    
    def _calculate_component_steady_state(
        self,
        comp: Any,
        fluid: str,
        config: SimulationConfig
    ) -> Dict[str, Any]:
        """Calculate steady-state for a single component"""
        # Simplified calculation
        params = {**get_default_params(comp.type), **comp.parameters}
        
        result = {
            'type': comp.type,
            'T_in': 300,
            'T_out': 400,
            'P_in': params.get('P_in', 101325),
            'P_out': params.get('P_out', 101325),
            'h_in': 100000,
            'h_out': 200000,
            'W_dot': 0,
            'Q_in': 0,
            'Q_out': 0
        }
        
        if comp.type in ['turbine']:
            result['W_dot'] = 100000  # 100 kW
        elif comp.type in ['compressor', 'pump']:
            result['W_dot'] = -50000  # -50 kW (input)
        elif comp.type in ['boiler', 'heater']:
            result['Q_in'] = 300000  # 300 kW
        elif comp.type in ['condenser', 'cooler']:
            result['Q_out'] = 250000  # 250 kW
        
        return result
    
    def _get_inlet_state(
        self,
        comp_id: str,
        topology: Any,
        y: np.ndarray,
        state_var_map: List[Dict]
    ) -> Optional[Dict[str, float]]:
        """Get inlet state for a component from upstream"""
        # Find upstream connection
        for conn in topology.connections:
            if conn.to_id == comp_id:
                # Find upstream component's outlet state
                upstream_id = conn.from_id
                
                # Look up in state var map
                for svm in state_var_map:
                    if svm['component_id'] == upstream_id:
                        return {'T': y[svm['index']], 'h': 0, 's': 0}
        
        return None
    
    def _extract_component_states(
        self,
        y: np.ndarray,
        components: List[Dict]
    ) -> Dict[str, ComponentState]:
        """Extract component states from ODE solution vector"""
        states = {}
        
        for comp in components:
            yi = y[comp['offset']:comp['offset'] + comp['length']]
            state_vars = comp['state_vars']
            
            state = ComponentState(
                component_id=comp['id']
            )
            
            # Map state variables
            for i, sv in enumerate(state_vars):
                if i < len(yi):
                    if sv.startswith('T'):
                        if sv == 'T_wall':
                            state.T_wall = yi[i]
                        else:
                            state.T = yi[i]
                    elif sv == 'omega':
                        state.omega = yi[i]
                    elif sv == 'h_fluid':
                        state.h = yi[i]
            
            states[comp['id']] = state
        
        return states
    
    def _build_state_points_table(
        self,
        topology: Any,
        final_state: Optional[TimePointResult]
    ) -> List[Dict[str, Any]]:
        """Build state points table from final state"""
        table = []
        
        for i, sp in enumerate(topology.state_points[:4]):  # Limit to 4 states for now
            table.append({
                'state': f'{i+1}',
                'description': sp.description,
                'T': 300 + i * 50,  # Placeholder
                'P': 101325,
                'h': 100000 + i * 50000,
                's': 1000 + i * 100,
                'x': None,
                'psi': 0
            })
        
        return table
    
    def _auto_select_solver(self, components: List[Dict]) -> str:
        """Auto-select best ODE solver"""
        # Check for thermal mass
        has_large_thermal_mass = any(
            comp['params'].get('wall_mass', 0) > 100
            for comp in components
        )
        
        if has_large_thermal_mass:
            return 'Radau'  # Stiff system
        
        return 'RK45'  # Non-stiff
    
    def _error_result(self, message: str) -> SimulationResult:
        """Create error result"""
        return SimulationResult(
            success=False,
            mode=SimulationMode.STEADY_STATE,
            cycle_type='unknown',
            errors=[message]
        )
