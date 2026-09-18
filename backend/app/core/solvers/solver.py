"""
Main solver coordinator - orchestrates all analysis components.
"""
from typing import Dict, List, Optional, Any
import logging
import time

from app.core.components.base import BaseComponent, ComponentResult
from app.core.solvers.energy_balance import EnergyBalanceSolver, EnergyBalanceResult
from app.core.solvers.entropy_gen import EntropyGenerationSolver, EntropyGenerationResult
from app.core.solvers.exergy import ExergyAnalysisSolver, ExergyAnalysisResult
from app.core.solvers.commentary import CommentaryGenerator, Commentary

logger = logging.getLogger(__name__)


class SolverResult:
    """Complete results from cycle analysis."""
    
    def __init__(self):
        self.success: bool = False
        self.error_message: Optional[str] = None
        self.execution_time_ms: int = 0
        
        # Component results
        self.component_results: Dict[str, ComponentResult] = {}
        
        # Analysis results
        self.energy_balance: Optional[EnergyBalanceResult] = None
        self.entropy_generation: Optional[EntropyGenerationResult] = None
        self.exergy_analysis: Optional[ExergyAnalysisResult] = None
        self.commentary: Optional[Commentary] = None
        
        # Overall metrics
        self.net_power: Optional[float] = None          # W
        self.thermal_efficiency: Optional[float] = None  # 0-1
        self.cop: Optional[float] = None                 # For refrigeration
        self.exergy_efficiency: Optional[float] = None   # 0-1
        
        self.warnings: List[str] = []
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary."""
        return {
            'success': self.success,
            'error_message': self.error_message,
            'execution_time_ms': self.execution_time_ms,
            'component_results': {
                comp_id: result.to_dict()
                for comp_id, result in self.component_results.items()
            },
            'energy_balance': self.energy_balance.to_dict() if self.energy_balance else None,
            'entropy_generation': self.entropy_generation.to_dict() if self.entropy_generation else None,
            'exergy_analysis': self.exergy_analysis.to_dict() if self.exergy_analysis else None,
            'commentary': self.commentary.to_dict() if self.commentary else None,
            'net_power': self.net_power,
            'thermal_efficiency': self.thermal_efficiency,
            'cop': self.cop,
            'exergy_efficiency': self.exergy_efficiency,
            'warnings': self.warnings
        }


class CycleSolver:
    """
    Main solver for thermodynamic cycles.
    
    Coordinates:
    1. Component-level calculations
    2. Energy balance validation
    3. Entropy generation analysis
    4. Exergy analysis
    5. Commentary generation
    """
    
    def __init__(
        self,
        ambient_temperature: float = 298.15,
        ambient_pressure: float = 101325,
        tolerance: float = 0.01,
        max_iterations: int = 100
    ):
        """
        Initialize cycle solver.
        
        Args:
            ambient_temperature: Dead state temperature (K)
            ambient_pressure: Dead state pressure (Pa)
            tolerance: Convergence tolerance for iterative solving
            max_iterations: Maximum iterations for convergence
        """
        self.T0 = ambient_temperature
        self.P0 = ambient_pressure
        self.tolerance = tolerance
        self.max_iterations = max_iterations
        
        # Initialize sub-solvers
        self.energy_solver = EnergyBalanceSolver(tolerance=tolerance)
        self.entropy_solver = EntropyGenerationSolver(ambient_temperature=ambient_temperature)
        self.exergy_solver = ExergyAnalysisSolver(
            ambient_temperature=ambient_temperature,
            ambient_pressure=ambient_pressure
        )
        self.commentary_gen = CommentaryGenerator()
    
    def solve(
        self,
        components: List[BaseComponent],
        cycle_type: str = "power"
    ) -> SolverResult:
        """
        Solve complete cycle analysis.
        
        Args:
            components: List of all components in the cycle
            cycle_type: Type of cycle ('power', 'refrigeration', 'heat_pump')
            
        Returns:
            SolverResult with complete analysis
        """
        result = SolverResult()
        start_time = time.time()
        
        try:
            logger.info(f"Starting cycle analysis with {len(components)} components")
            
            # Step 1: Calculate each component
            logger.info("Step 1: Calculating individual components...")
            component_results = self._calculate_components(components)
            result.component_results = component_results
            
            # Check if all components calculated successfully
            failed_components = [
                comp.name for comp in components
                if not component_results.get(comp.id, ComponentResult(success=False)).success
            ]
            
            if failed_components:
                result.error_message = (
                    f"Failed to calculate components: {', '.join(failed_components)}"
                )
                result.warnings.append(result.error_message)
                logger.warning(result.error_message)
                # Continue with partial analysis
            
            # Step 2: Energy balance
            logger.info("Step 2: Performing energy balance...")
            result.energy_balance = self.energy_solver.solve(components, component_results)
            result.warnings.extend(result.energy_balance.warnings)
            
            # Step 3: Entropy generation
            logger.info("Step 3: Analyzing entropy generation...")
            result.entropy_generation = self.entropy_solver.solve(components, component_results)
            result.warnings.extend(result.entropy_generation.warnings)
            
            # Step 4: Exergy analysis
            logger.info("Step 4: Performing exergy analysis...")
            working_fluid = self._detect_working_fluid(components)
            result.exergy_analysis = self.exergy_solver.solve(
                components,
                component_results,
                fluid=working_fluid
            )
            result.warnings.extend(result.exergy_analysis.warnings)
            
            # Step 5: Generate commentary
            logger.info("Step 5: Generating commentary...")
            result.commentary = self.commentary_gen.generate(
                result.energy_balance,
                result.entropy_generation,
                result.exergy_analysis,
                cycle_type
            )
            
            # Calculate overall metrics
            self._calculate_overall_metrics(result, cycle_type)
            
            # Mark as successful if we got this far
            result.success = True
            
            logger.info("Cycle analysis completed successfully")
            
        except Exception as e:
            logger.error(f"Cycle analysis failed: {e}", exc_info=True)
            result.success = False
            result.error_message = f"Cycle analysis failed: {str(e)}"
        
        finally:
            # Calculate execution time
            end_time = time.time()
            result.execution_time_ms = int((end_time - start_time) * 1000)
        
        return result
    
    def _calculate_components(
        self,
        components: List[BaseComponent]
    ) -> Dict[str, ComponentResult]:
        """
        Calculate all components in the cycle.
        
        Args:
            components: List of components
            
        Returns:
            Dictionary mapping component ID to ComponentResult
        """
        results = {}
        
        # Simple sequential calculation
        # For more complex cycles, would need iterative solving
        for component in components:
            try:
                logger.debug(f"Calculating component: {component.name}")
                result = component.calculate()
                results[component.id] = result
                
                if not result.success:
                    logger.warning(
                        f"Component '{component.name}' calculation failed: "
                        f"{result.error_message}"
                    )
            except Exception as e:
                logger.error(f"Error calculating component '{component.name}': {e}")
                results[component.id] = ComponentResult(
                    success=False,
                    error_message=str(e)
                )
        
        return results
    
    def _detect_working_fluid(self, components: List[BaseComponent]) -> str:
        """
        Detect the working fluid from components.
        
        Args:
            components: List of components
            
        Returns:
            Working fluid name (defaults to 'Water')
        """
        # Try to get fluid from first component with inlet state
        for component in components:
            inlet_state = component.get_inlet_state()
            if inlet_state and inlet_state.fluid:
                return inlet_state.fluid
        
        # Default to water
        return "Water"
    
    def _calculate_overall_metrics(
        self,
        result: SolverResult,
        cycle_type: str
    ) -> None:
        """
        Calculate overall cycle performance metrics.
        
        Args:
            result: SolverResult to populate
            cycle_type: Type of cycle
        """
        if result.energy_balance is None:
            return
        
        energy = result.energy_balance
        
        # Net power
        result.net_power = energy.net_work
        
        # Cycle-specific metrics
        if cycle_type == "power":
            # Thermal efficiency
            if energy.total_heat_input > 0:
                result.thermal_efficiency = energy.net_work / energy.total_heat_input
            
        elif cycle_type in ["refrigeration", "heat_pump"]:
            # COP
            if energy.net_work < 0:  # Work input
                if cycle_type == "refrigeration":
                    # COP_cooling = Q_evap / W_in
                    result.cop = energy.total_heat_input / abs(energy.net_work)
                else:  # heat_pump
                    # COP_heating = Q_cond / W_in
                    result.cop = energy.total_heat_output / abs(energy.net_work)
        
        # Exergy efficiency
        if result.exergy_analysis:
            result.exergy_efficiency = result.exergy_analysis.exergy_efficiency
    
    def generate_full_report(self, result: SolverResult) -> str:
        """
        Generate complete analysis report.
        
        Args:
            result: SolverResult
            
        Returns:
            Formatted report string
        """
        if not result.success:
            return f"Analysis failed: {result.error_message}"
        
        lines = []
        
        # Commentary report
        if result.commentary and result.energy_balance and result.entropy_generation and result.exergy_analysis:
            lines.append(
                self.commentary_gen.generate_full_report(
                    result.commentary,
                    result.energy_balance,
                    result.entropy_generation,
                    result.exergy_analysis
                )
            )
            lines.append("")
        
        # Energy balance report
        if result.energy_balance:
            lines.append(self.energy_solver.generate_report(result.energy_balance))
            lines.append("")
        
        # Entropy generation report
        if result.entropy_generation:
            lines.append(self.entropy_solver.generate_report(result.entropy_generation))
            lines.append("")
        
        # Exergy analysis report
        if result.exergy_analysis:
            lines.append(self.exergy_solver.generate_report(result.exergy_analysis))
            lines.append("")
        
        # Execution info
        lines.append("=" * 60)
        lines.append(f"Analysis completed in {result.execution_time_ms} ms")
        lines.append("=" * 60)
        
        return "\n".join(lines)
