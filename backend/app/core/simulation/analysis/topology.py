"""
Cycle Topology Analyzer - Understands ANY canvas layout
"""

from typing import List, Dict, Tuple, Set, Optional
from dataclasses import dataclass, field
from enum import Enum
import networkx as nx


class CycleType(str, Enum):
    """Detected cycle types"""
    RANKINE = "rankine"  # Steam power
    BRAYTON = "brayton"  # Gas turbine
    VAPOR_COMPRESSION = "vapor_compression"  # Refrigeration/heat pump
    ORC = "orc"  # Organic Rankine
    COMBINED = "combined"  # Combined cycle
    COGENERATION = "cogeneration"
    CUSTOM = "custom"


@dataclass
class Connection:
    """Connection between components"""
    from_id: str
    to_id: str
    from_port: str = "outlet"
    to_port: str = "inlet"
    fluid: str = "Water"


@dataclass
class Component:
    """Canvas component"""
    id: str
    type: str
    name: str
    position: Dict[str, float] = field(default_factory=dict)
    parameters: Dict[str, float] = field(default_factory=dict)


@dataclass
class StatePoint:
    """Thermodynamic state point in cycle"""
    id: str
    component_out: str
    component_in: str
    order: int
    description: str = ""


@dataclass
class TopologyAnalysis:
    """Complete topology analysis"""
    cycle_type: CycleType
    components: List[Component]
    connections: List[Connection]
    
    # Flow analysis
    state_points: List[StatePoint] = field(default_factory=list)
    flow_direction: Dict[str, str] = field(default_factory=dict)
    
    # Cycle characteristics
    has_heat_input: bool = False
    has_heat_output: bool = False
    has_work_input: bool = False
    has_work_output: bool = False
    
    # Heat exchangers
    heat_input_components: List[str] = field(default_factory=list)
    heat_output_components: List[str] = field(default_factory=list)
    
    # Work devices
    work_producers: List[str] = field(default_factory=list)
    work_consumers: List[str] = field(default_factory=list)
    
    # Fluid streams
    hot_stream_components: List[str] = field(default_factory=list)
    cold_stream_components: List[str] = field(default_factory=list)
    
    # Graph structure
    graph: Optional[nx.DiGraph] = None
    cycles: List[List[str]] = field(default_factory=list)


class TopologyAnalyzer:
    """Analyze any canvas topology"""
    
    def __init__(self, components: List[Dict], connections: List[Dict]):
        self.raw_components = components
        self.raw_connections = connections
        
        # Parse into objects
        self.components = self._parse_components(components)
        self.connections = self._parse_connections(connections)
        
        # Build graph
        self.graph = self._build_graph()
    
    def _parse_components(self, raw: List[Dict]) -> Dict[str, Component]:
        """Parse component dictionaries"""
        return {
            c['id']: Component(
                id=c['id'],
                type=c.get('type', 'unknown'),
                name=c.get('name', c['id']),
                position=c.get('position', {}),
                parameters=c.get('parameters', {})
            )
            for c in raw
        }
    
    def _parse_connections(self, raw: List[Dict]) -> List[Connection]:
        """Parse connection dictionaries"""
        return [
            Connection(
                from_id=c['from'],
                to_id=c['to'],
                from_port=c.get('fromPort', 'outlet'),
                to_port=c.get('toPort', 'inlet'),
                fluid=c.get('fluid', 'Water')
            )
            for c in raw
        ]
    
    def _build_graph(self) -> nx.DiGraph:
        """Build NetworkX directed graph"""
        G = nx.DiGraph()
        
        # Add nodes
        for comp_id, comp in self.components.items():
            G.add_node(comp_id, **{
                'type': comp.type,
                'name': comp.name,
                'parameters': comp.parameters
            })
        
        # Add edges
        for conn in self.connections:
            G.add_edge(
                conn.from_id,
                conn.to_id,
                from_port=conn.from_port,
                to_port=conn.to_port,
                fluid=conn.fluid
            )
        
        return G
    
    def analyze(self) -> TopologyAnalysis:
        """Perform complete topology analysis"""
        analysis = TopologyAnalysis(
            cycle_type=self._detect_cycle_type(),
            components=list(self.components.values()),
            connections=self.connections,
            graph=self.graph
        )
        
        # Analyze component roles
        analysis.heat_input_components = self._find_heat_inputs()
        analysis.heat_output_components = self._find_heat_outputs()
        analysis.work_producers = self._find_work_producers()
        analysis.work_consumers = self._find_work_consumers()
        
        analysis.has_heat_input = len(analysis.heat_input_components) > 0
        analysis.has_heat_output = len(analysis.heat_output_components) > 0
        analysis.has_work_output = len(analysis.work_producers) > 0
        analysis.has_work_input = len(analysis.work_consumers) > 0
        
        # Find state points
        analysis.state_points = self._identify_state_points()
        
        # Find cycles in graph
        try:
            analysis.cycles = list(nx.simple_cycles(self.graph))
        except:
            analysis.cycles = []
        
        return analysis
    
    def _detect_cycle_type(self) -> CycleType:
        """Auto-detect cycle type from component composition"""
        types = set(c.type for c in self.components.values())
        
        # Count key components
        has_boiler = 'boiler' in types or 'hrsg' in types
        has_condenser = 'condenser' in types or 'cooler' in types
        has_evaporator = 'evaporator' in types
        has_turbine = 'turbine' in types
        has_compressor = 'compressor' in types
        has_pump = 'pump' in types
        has_throttle = 'throttle' in types or 'expansion_valve' in types
        
        # Vapor Compression (Refrigeration/Heat Pump)
        # Compressor + Evaporator + Condenser + Expansion
        if has_compressor and has_evaporator and has_condenser and has_throttle:
            return CycleType.VAPOR_COMPRESSION
        
        # ORC (Organic Rankine)
        # Has ORC-specific components or working fluid hint
        if 'orc_turbine' in types or 'working_fluid_pump' in types:
            return CycleType.ORC
        
        # Rankine Cycle
        # Pump + Boiler + Turbine + Condenser
        if has_pump and has_boiler and has_turbine and has_condenser:
            return CycleType.RANKINE
        
        # Brayton Cycle
        # Compressor + Combustor/Heater + Turbine
        if has_compressor and (has_boiler or 'heater' in types or 'combustor' in types) and has_turbine:
            return CycleType.BRAYTON
        
        # Combined Cycle
        if 'hrsg' in types or 'heat_recovery' in types:
            return CycleType.COMBINED
        
        # Cogeneration
        if len(analysis.heat_output_components) > 1 and has_work_output:
            return CycleType.COGENERATION
        
        return CycleType.CUSTOM
    
    def _find_heat_inputs(self) -> List[str]:
        """Find components that add heat"""
        heat_input_types = {'boiler', 'heater', 'combustor', 'evaporator', 'hrsg'}
        return [
            comp_id for comp_id, comp in self.components.items()
            if comp.type in heat_input_types
        ]
    
    def _find_heat_outputs(self) -> List[str]:
        """Find components that reject heat"""
        heat_output_types = {'condenser', 'cooler', 'radiator'}
        return [
            comp_id for comp_id, comp in self.components.items()
            if comp.type in heat_output_types
        ]
    
    def _find_work_producers(self) -> List[str]:
        """Find components that produce work"""
        producer_types = {'turbine', 'expander'}
        return [
            comp_id for comp_id, comp in self.components.items()
            if comp.type in producer_types
        ]
    
    def _find_work_consumers(self) -> List[str]:
        """Find components that consume work"""
        consumer_types = {'compressor', 'pump', 'fan'}
        return [
            comp_id for comp_id, comp in self.components.items()
            if comp.type in consumer_types
        ]
    
    def _identify_state_points(self) -> List[StatePoint]:
        """Identify thermodynamic state points in order"""
        state_points = []
        order = 0
        
        # Try to find starting point (component with no incoming)
        sources = [
            n for n in self.graph.nodes()
            if self.graph.in_degree(n) == 0 and self.graph.out_degree(n) > 0
        ]
        
        if not sources:
            # No clear source, pick first component
            sources = list(self.graph.nodes())[:1]
        
        visited = set()
        
        def traverse_from(node_id: str):
            nonlocal order
            if node_id in visited:
                return
            visited.add(node_id)
            
            # Visit outgoing edges
            for successor in self.graph.successors(node_id):
                edge_data = self.graph.edges[node_id, successor]
                
                state_points.append(StatePoint(
                    id=f"state_{order}",
                    component_out=node_id,
                    component_in=successor,
                    order=order,
                    description=f"Between {node_id} and {successor}"
                ))
                order += 1
                
                traverse_from(successor)
        
        for source in sources:
            traverse_from(source)
        
        return state_points
    
    def get_component_order(self) -> List[str]:
        """Get topological ordering of components"""
        try:
            return list(nx.topological_sort(self.graph))
        except nx.NetworkXError:
            # Graph has cycles, use different approach
            # Return nodes in discovery order
            return list(self.graph.nodes())
    
    def get_coupled_components(self) -> List[Tuple[str, str, str]]:
        """
        Get list of coupled components for ODE boundary conditions
        Returns: [(from_id, to_id, coupling_type), ...]
        """
        couplings = []
        
        for from_id, to_id in self.graph.edges():
            from_type = self.components[from_id].type
            to_type = self.components[to_id].type
            
            # Determine coupling type
            if from_type in ['boiler', 'condenser', 'evaporator', 'heater', 'cooler']:
                coupling_type = 'thermodynamic_state'
            elif from_type in ['turbine', 'compressor', 'pump']:
                coupling_type = 'work_transfer'
            elif from_type in ['throttle', 'expansion_valve']:
                coupling_type = 'isenthalpic'
            elif from_type == 'splitter':
                coupling_type = 'flow_division'
            elif from_type == 'mixer':
                coupling_type = 'flow_mixing'
            elif from_type == 'tank':
                coupling_type = 'accumulation'
            else:
                coupling_type = 'direct'
            
            couplings.append((from_id, to_id, coupling_type))
        
        return couplings
    
    def get_fluid_at_state(self, state_point_id: str) -> str:
        """Determine working fluid at a state point"""
        for conn in self.connections:
            state_id = f"{conn.from_id}_to_{conn.to_id}"
            if state_id == state_point_id or conn.from_id in state_point_id:
                return conn.fluid
        return "Water"  # Default
