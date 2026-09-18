"""
Commentary generator - creates human-readable insights about cycle performance.
"""
from typing import List, Dict
import logging

from app.core.solvers.energy_balance import EnergyBalanceResult
from app.core.solvers.entropy_gen import EntropyGenerationResult
from app.core.solvers.exergy import ExergyAnalysisResult

logger = logging.getLogger(__name__)


class Commentary:
    """Container for cycle analysis commentary."""
    
    def __init__(self):
        self.summary: str = ""
        self.performance_insights: List[str] = []
        self.improvement_suggestions: List[str] = []
        self.warnings: List[str] = []
        self.technical_notes: List[str] = []
    
    def to_dict(self) -> Dict:
        """Convert to dictionary."""
        return {
            'summary': self.summary,
            'performance_insights': self.performance_insights,
            'improvement_suggestions': self.improvement_suggestions,
            'warnings': self.warnings,
            'technical_notes': self.technical_notes
        }


class CommentaryGenerator:
    """
    Generates natural language commentary about cycle performance.
    Analyzes results and provides insights, suggestions, and warnings.
    """
    
    def __init__(self):
        """Initialize commentary generator."""
        pass
    
    def generate(
        self,
        energy_balance: EnergyBalanceResult,
        entropy_gen: EntropyGenerationResult,
        exergy_analysis: ExergyAnalysisResult,
        cycle_type: str = "power"
    ) -> Commentary:
        """
        Generate comprehensive commentary.
        
        Args:
            energy_balance: Energy balance results
            entropy_gen: Entropy generation results
            exergy_analysis: Exergy analysis results
            cycle_type: Type of cycle ('power', 'refrigeration', 'heat_pump')
            
        Returns:
            Commentary object with insights
        """
        commentary = Commentary()
        
        try:
            # Generate summary
            commentary.summary = self._generate_summary(
                energy_balance,
                entropy_gen,
                exergy_analysis,
                cycle_type
            )
            
            # Performance insights
            commentary.performance_insights = self._generate_performance_insights(
                energy_balance,
                entropy_gen,
                exergy_analysis,
                cycle_type
            )
            
            # Improvement suggestions
            commentary.improvement_suggestions = self._generate_improvements(
                energy_balance,
                entropy_gen,
                exergy_analysis,
                cycle_type
            )
            
            # Collect all warnings
            commentary.warnings.extend(energy_balance.warnings)
            commentary.warnings.extend(entropy_gen.warnings)
            commentary.warnings.extend(exergy_analysis.warnings)
            
            # Technical notes
            commentary.technical_notes = self._generate_technical_notes(
                energy_balance,
                entropy_gen,
                exergy_analysis,
                cycle_type
            )
            
        except Exception as e:
            logger.error(f"Commentary generation failed: {e}", exc_info=True)
            commentary.warnings.append(f"Error generating commentary: {str(e)}")
        
        return commentary
    
    def _generate_summary(
        self,
        energy: EnergyBalanceResult,
        entropy: EntropyGenerationResult,
        exergy: ExergyAnalysisResult,
        cycle_type: str
    ) -> str:
        """Generate executive summary."""
        lines = []
        
        if cycle_type == "power":
            # Power cycle summary
            thermal_eff = energy.net_work / energy.total_heat_input if energy.total_heat_input > 0 else 0
            
            lines.append(
                f"This power cycle produces {energy.net_work/1000:.2f} kW of net power output "
                f"with a thermal efficiency of {thermal_eff:.1%}."
            )
            
            if exergy.exergy_efficiency > 0:
                lines.append(
                    f"The exergy efficiency is {exergy.exergy_efficiency:.1%}, indicating "
                    f"that {(1-exergy.exergy_efficiency)*100:.1f}% of available energy is lost to irreversibilities."
                )
            
            # Back work ratio insight
            if energy.total_work_input > 0:
                bwr = energy.total_work_input / energy.total_work_output
                if bwr > 0.5:
                    lines.append(
                        f"The back work ratio is {bwr:.1%}, which is quite high. "
                        "A significant portion of turbine work is consumed by pumps/compressors."
                    )
        
        elif cycle_type == "refrigeration":
            # Refrigeration cycle summary
            cop = energy.total_heat_input / abs(energy.net_work) if energy.net_work < 0 else 0
            
            lines.append(
                f"This refrigeration cycle provides {energy.total_heat_input/1000:.2f} kW of cooling "
                f"with a COP of {cop:.2f}."
            )
            
            lines.append(
                f"The system requires {abs(energy.net_work)/1000:.2f} kW of work input "
                f"and rejects {energy.total_heat_output/1000:.2f} kW to the environment."
            )
        
        return " ".join(lines)
    
    def _generate_performance_insights(
        self,
        energy: EnergyBalanceResult,
        entropy: EntropyGenerationResult,
        exergy: ExergyAnalysisResult,
        cycle_type: str
    ) -> List[str]:
        """Generate performance insights."""
        insights = []
        
        # Energy balance insight
        if energy.is_balanced:
            insights.append("✓ Energy balance is satisfied within acceptable tolerance.")
        else:
            insights.append(
                f"⚠ Energy balance error of {energy.energy_balance_error_percent:.2f}% detected. "
                "Review component calculations."
            )
        
        # Entropy generation insight
        if entropy.is_physically_valid:
            insights.append("✓ All components show positive entropy generation (2nd Law satisfied).")
        else:
            insights.append(
                "⚠ Some components show negative entropy generation, violating the 2nd Law. "
                "This indicates calculation errors."
            )
        
        # Major irreversibility sources
        if entropy.major_irreversibilities:
            top_component, top_s_gen = entropy.major_irreversibilities[0]
            percentage = (top_s_gen / entropy.total_entropy_generation * 100) if entropy.total_entropy_generation > 0 else 0
            
            insights.append(
                f"The '{top_component}' contributes {percentage:.1f}% of total entropy generation, "
                "making it the largest source of irreversibility."
            )
        
        # Exergy efficiency insight
        if exergy.exergy_efficiency > 0:
            if exergy.exergy_efficiency > 0.5:
                insights.append(
                    f"The cycle achieves a good exergy efficiency of {exergy.exergy_efficiency:.1%}."
                )
            elif exergy.exergy_efficiency > 0.3:
                insights.append(
                    f"The exergy efficiency of {exergy.exergy_efficiency:.1%} indicates moderate performance "
                    "with room for improvement."
                )
            else:
                insights.append(
                    f"The exergy efficiency of {exergy.exergy_efficiency:.1%} is relatively low, "
                    "suggesting significant opportunities for optimization."
                )
        
        return insights
    
    def _generate_improvements(
        self,
        energy: EnergyBalanceResult,
        entropy: EntropyGenerationResult,
        exergy: ExergyAnalysisResult,
        cycle_type: str
    ) -> List[str]:
        """Generate improvement suggestions."""
        suggestions = []
        
        # Identify components with highest losses
        if exergy.major_losses:
            for comp_name, ex_dest in exergy.major_losses[:3]:  # Top 3
                percentage = (ex_dest / exergy.total_exergy_destruction * 100) if exergy.total_exergy_destruction > 0 else 0
                
                if percentage > 25:
                    suggestions.append(
                        f"Consider optimizing '{comp_name}' - it accounts for {percentage:.1f}% "
                        "of total exergy destruction. "
                        + self._get_component_specific_suggestion(comp_name)
                    )
        
        # General efficiency improvements
        if cycle_type == "power":
            thermal_eff = energy.net_work / energy.total_heat_input if energy.total_heat_input > 0 else 0
            
            if thermal_eff < 0.3:
                suggestions.append(
                    "Thermal efficiency is below 30%. Consider: "
                    "increasing turbine inlet temperature, "
                    "reducing condenser pressure, "
                    "or adding regeneration."
                )
            
            # Back work ratio
            if energy.total_work_output > 0:
                bwr = energy.total_work_input / energy.total_work_output
                if bwr > 0.4:
                    suggestions.append(
                        "High back work ratio detected. Consider: "
                        "improving pump/compressor efficiency, "
                        "or reducing pressure ratios."
                    )
        
        elif cycle_type == "refrigeration":
            cop = energy.total_heat_input / abs(energy.net_work) if energy.net_work < 0 else 0
            
            if cop < 3:
                suggestions.append(
                    "COP is below 3. Consider: "
                    "improving compressor efficiency, "
                    "reducing pressure ratio, "
                    "or adding subcooling/superheating."
                )
        
        return suggestions
    
    def _get_component_specific_suggestion(self, component_name: str) -> str:
        """Get specific suggestion based on component type."""
        name_lower = component_name.lower()
        
        if "pump" in name_lower:
            return "Increase pump efficiency or reduce pressure rise requirements."
        elif "turbine" in name_lower:
            return "Increase turbine efficiency or optimize pressure ratio."
        elif "compressor" in name_lower:
            return "Improve compressor efficiency or add intercooling."
        elif "heat exchanger" in name_lower or "boiler" in name_lower:
            return "Increase heat exchanger effectiveness or reduce temperature pinch."
        elif "condenser" in name_lower:
            return "Optimize condensing temperature or increase heat transfer area."
        elif "valve" in name_lower or "throttle" in name_lower:
            return "Consider replacing throttling valve with expander to recover work."
        else:
            return "Review component design and operating parameters."
    
    def _generate_technical_notes(
        self,
        energy: EnergyBalanceResult,
        entropy: EntropyGenerationResult,
        exergy: ExergyAnalysisResult,
        cycle_type: str
    ) -> List[str]:
        """Generate technical notes for detailed analysis."""
        notes = []
        
        # Energy balance details
        if energy.component_breakdown:
            notes.append(
                f"Energy balance verified across {len(energy.component_breakdown)} components "
                f"with {energy.energy_balance_error_percent:.3f}% error."
            )
        
        # Entropy generation totals
        if entropy.total_entropy_generation > 0:
            notes.append(
                f"Total entropy generation: {entropy.total_entropy_generation:.6f} W/K, "
                f"corresponding to {exergy.total_exergy_destruction/1000:.2f} kW of exergy destruction."
            )
        
        # Exergy accounting
        if exergy.total_exergy_input > 0:
            exergy_destroyed_percent = (exergy.total_exergy_destruction / exergy.total_exergy_input) * 100
            notes.append(
                f"Of the {exergy.total_exergy_input/1000:.2f} kW input exergy, "
                f"{exergy_destroyed_percent:.1f}% is destroyed due to irreversibilities."
            )
        
        return notes
    
    def generate_full_report(
        self,
        commentary: Commentary,
        energy_balance: EnergyBalanceResult,
        entropy_gen: EntropyGenerationResult,
        exergy_analysis: ExergyAnalysisResult
    ) -> str:
        """
        Generate complete analysis report with commentary.
        
        Args:
            commentary: Commentary object
            energy_balance: Energy balance results
            entropy_gen: Entropy generation results
            exergy_analysis: Exergy analysis results
            
        Returns:
            Formatted report string
        """
        lines = []
        lines.append("=" * 70)
        lines.append("THERMODYNAMIC CYCLE ANALYSIS REPORT")
        lines.append("=" * 70)
        lines.append("")
        
        # Summary
        lines.append("EXECUTIVE SUMMARY")
        lines.append("-" * 70)
        lines.append(commentary.summary)
        lines.append("")
        
        # Performance Insights
        if commentary.performance_insights:
            lines.append("PERFORMANCE INSIGHTS")
            lines.append("-" * 70)
            for insight in commentary.performance_insights:
                lines.append(f"  • {insight}")
            lines.append("")
        
        # Improvement Suggestions
        if commentary.improvement_suggestions:
            lines.append("IMPROVEMENT SUGGESTIONS")
            lines.append("-" * 70)
            for i, suggestion in enumerate(commentary.improvement_suggestions, 1):
                lines.append(f"  {i}. {suggestion}")
            lines.append("")
        
        # Warnings
        if commentary.warnings:
            lines.append("WARNINGS")
            lines.append("-" * 70)
            for warning in commentary.warnings:
                lines.append(f"  ⚠ {warning}")
            lines.append("")
        
        # Technical Notes
        if commentary.technical_notes:
            lines.append("TECHNICAL NOTES")
            lines.append("-" * 70)
            for note in commentary.technical_notes:
                lines.append(f"  • {note}")
            lines.append("")
        
        lines.append("=" * 70)
        
        return "\n".join(lines)
