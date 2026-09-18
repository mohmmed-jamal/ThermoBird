"""
Entropy generation solver - calculates irreversibilities in the cycle.
"""
from typing import Dict, List, Tuple, Optional
import logging

from app.core.components.base import BaseComponent, ComponentResult

logger = logging.getLogger(__name__)


class EntropyGenerationResult:
    """Results from entropy generation analysis."""
    
    def __init__(self):
        self.total_entropy_generation: float = 0.0  # W/K
        self.component_entropy_gen: Dict[str, float] = {}
        self.major_irreversibilities: List[Tuple[str, float]] = []  # [(component_name, entropy_gen), ...]
        self.is_physically_valid: bool = True
        self.warnings: List[str] = []
    
    def to_dict(self) -> Dict:
        """Convert to dictionary."""
        return {
            'total_entropy_generation': self.total_entropy_generation,
            'component_entropy_gen': self.component_entropy_gen,
            'major_irreversibilities': [
                {'component': comp, 'entropy_generation': s_gen}
                for comp, s_gen in self.major_irreversibilities
            ],
            'is_physically_valid': self.is_physically_valid,
            'warnings': self.warnings
        }


class EntropyGenerationSolver:
    """
    Solves for entropy generation in thermodynamic cycles.
    
    Identifies:
    - Total entropy generation (must be >= 0 by 2nd Law)
    - Component-level irreversibilities
    - Major sources of losses
    """
    
    def __init__(self, ambient_temperature: float = 298.15):
        """
        Initialize entropy generation solver.
        
        Args:
            ambient_temperature: Dead state temperature (K) for exergy calculations
        """
        self.T0 = ambient_temperature
    
    def solve(
        self,
        components: List[BaseComponent],
        results: Dict[str, ComponentResult]
    ) -> EntropyGenerationResult:
        """
        Perform entropy generation analysis.
        
        Args:
            components: List of all components in the cycle
            results: Dictionary mapping component ID to its ComponentResult
            
        Returns:
            EntropyGenerationResult with entropy analysis
        """
        result = EntropyGenerationResult()
        
        try:
            # Calculate entropy generation for each component
            for component in components:
                comp_result = results.get(component.id)
                
                if comp_result is None or not comp_result.success:
                    result.warnings.append(
                        f"Component '{component.name}' has no valid result"
                    )
                    continue
                
                # Get entropy generation from component result
                s_gen = comp_result.entropy_generation or 0.0
                
                # Validate (entropy generation must be non-negative)
                if s_gen < -1e-6:  # Small negative tolerance for numerical errors
                    result.warnings.append(
                        f"Component '{component.name}' has negative entropy generation: "
                        f"{s_gen:.6f} W/K. This violates the 2nd Law."
                    )
                    result.is_physically_valid = False
                    s_gen = 0.0  # Set to zero to continue analysis
                
                # Store component entropy generation
                result.component_entropy_gen[component.name] = s_gen
                result.total_entropy_generation += s_gen
            
            # Identify major irreversibilities (top contributors)
            sorted_components = sorted(
                result.component_entropy_gen.items(),
                key=lambda x: x[1],
                reverse=True
            )
            
            # Take top 5 or all if less than 5
            result.major_irreversibilities = sorted_components[:5]
            
            # Validate total entropy generation
            if result.total_entropy_generation < -1e-6:
                result.warnings.append(
                    f"Total entropy generation is negative: "
                    f"{result.total_entropy_generation:.6f} W/K. "
                    "This violates the 2nd Law of Thermodynamics."
                )
                result.is_physically_valid = False
            
            # Calculate percentage contributions
            if result.total_entropy_generation > 0:
                self._analyze_contributions(result)
            
        except Exception as e:
            logger.error(f"Entropy generation calculation failed: {e}", exc_info=True)
            result.warnings.append(f"Error during entropy analysis: {str(e)}")
            result.is_physically_valid = False
        
        return result
    
    def _analyze_contributions(self, result: EntropyGenerationResult) -> None:
        """
        Analyze which components contribute most to irreversibilities.
        
        Args:
            result: EntropyGenerationResult to analyze
        """
        for comp_name, s_gen in result.component_entropy_gen.items():
            contribution = (s_gen / result.total_entropy_generation) * 100
            
            # Flag components with high contributions
            if contribution > 30:
                result.warnings.append(
                    f"Component '{comp_name}' contributes {contribution:.1f}% of total "
                    "entropy generation. Consider design improvements."
                )
    
    def calculate_exergy_destruction(
        self,
        entropy_gen_result: EntropyGenerationResult
    ) -> Dict[str, float]:
        """
        Calculate exergy destruction from entropy generation.
        
        Exergy destruction = T0 * S_gen
        
        Args:
            entropy_gen_result: EntropyGenerationResult
            
        Returns:
            Dictionary mapping component name to exergy destruction (W)
        """
        exergy_destruction = {}
        
        for comp_name, s_gen in entropy_gen_result.component_entropy_gen.items():
            exergy_destruction[comp_name] = self.T0 * s_gen
        
        return exergy_destruction
    
    def get_isentropic_efficiency(
        self,
        component_name: str,
        component_result: ComponentResult
    ) -> Optional[float]:
        """
        Calculate isentropic efficiency from entropy generation.
        
        Args:
            component_name: Name of component
            component_result: ComponentResult for the component
            
        Returns:
            Isentropic efficiency or None if not applicable
        """
        # This is already stored in component_result.efficiency
        return component_result.efficiency
    
    def generate_report(self, result: EntropyGenerationResult) -> str:
        """
        Generate human-readable entropy generation report.
        
        Args:
            result: EntropyGenerationResult
            
        Returns:
            Formatted report string
        """
        lines = []
        lines.append("=" * 60)
        lines.append("ENTROPY GENERATION ANALYSIS")
        lines.append("=" * 60)
        lines.append("")
        
        # Overall entropy generation
        lines.append(f"Total Entropy Generation: {result.total_entropy_generation:.6f} W/K")
        lines.append("")
        
        # Validation status
        status = "VALID ✓" if result.is_physically_valid else "INVALID ✗"
        lines.append(f"2nd Law Status: {status}")
        lines.append("")
        
        # Major irreversibilities
        if result.major_irreversibilities:
            lines.append("Major Sources of Irreversibility:")
            total_s_gen = result.total_entropy_generation
            
            for i, (comp_name, s_gen) in enumerate(result.major_irreversibilities, 1):
                percentage = (s_gen / total_s_gen * 100) if total_s_gen > 0 else 0
                exergy_dest = self.T0 * s_gen / 1000  # kW
                
                lines.append(f"  {i}. {comp_name}")
                lines.append(f"     Entropy Generation: {s_gen:.6f} W/K ({percentage:.1f}%)")
                lines.append(f"     Exergy Destruction: {exergy_dest:.2f} kW")
            lines.append("")
        
        # Component breakdown
        if result.component_entropy_gen:
            lines.append("Component-by-Component Breakdown:")
            
            # Sort by entropy generation (highest first)
            sorted_components = sorted(
                result.component_entropy_gen.items(),
                key=lambda x: x[1],
                reverse=True
            )
            
            for comp_name, s_gen in sorted_components:
                percentage = (s_gen / result.total_entropy_generation * 100) if result.total_entropy_generation > 0 else 0
                lines.append(f"  {comp_name}:")
                lines.append(f"    S_gen: {s_gen:.6f} W/K ({percentage:.1f}%)")
            lines.append("")
        
        # Total exergy destruction
        total_exergy_dest = self.T0 * result.total_entropy_generation / 1000  # kW
        lines.append(f"Total Exergy Destruction: {total_exergy_dest:.2f} kW")
        lines.append(f"  (at T₀ = {self.T0:.2f} K)")
        lines.append("")
        
        # Warnings
        if result.warnings:
            lines.append("Warnings:")
            for warning in result.warnings:
                lines.append(f"  ⚠ {warning}")
            lines.append("")
        
        lines.append("=" * 60)
        
        return "\n".join(lines)
