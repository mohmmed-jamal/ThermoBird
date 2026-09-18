"use client";
import { useState, useEffect, useRef } from "react";
import { ArrowRight, Link, Zap, FlaskConical, BarChart3, Terminal, Cpu, LayoutDashboard, SlidersHorizontal } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export type TimelineItemStatus = "completed" | "in-progress" | "pending";

export interface TimelineItem {
  id: number;
  title: string;
  date: string;
  content: string;
  category: string;
  icon: React.ElementType;
  relatedIds: number[];
  status: TimelineItemStatus;
  energy: number;
  color: string;
}

export interface RadialOrbitalTimelineProps {
  timelineData: TimelineItem[];
  className?: string;
}

// High contrast corporate colors
const COLORS = {
  cyan: "#22d3ee",       // Bright cyan for visibility
  indigo: "#818cf8",     // Bright indigo
  orange: "#fb923c",     // Bright orange
  amber: "#fbbf24",      // Bright amber
  emerald: "#34d399",    // Bright emerald
  rose: "#fb7185",       // Bright rose
};

export default function RadialOrbitalTimeline({
  timelineData,
  className = "",
}: RadialOrbitalTimelineProps) {
  const [expandedItems, setExpandedItems] = useState<Record<number, boolean>>({});
  const [rotationAngle, setRotationAngle] = useState<number>(0);
  const [autoRotate, setAutoRotate] = useState<boolean>(true);
  const [activeNodeId, setActiveNodeId] = useState<number | null>(null);
  const [hoveredNodeId, setHoveredNodeId] = useState<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const nodeRefs = useRef<Record<number, HTMLDivElement | null>>({});

  const handleContainerClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === containerRef.current) {
      setExpandedItems({});
      setActiveNodeId(null);
      setAutoRotate(true);
    }
  };

  const toggleItem = (id: number) => {
    setExpandedItems((prev) => {
      const newState = { ...prev };
      Object.keys(newState).forEach((key) => {
        if (parseInt(key) !== id) {
          newState[parseInt(key)] = false;
        }
      });

      newState[id] = !prev[id];

      if (!prev[id]) {
        setActiveNodeId(id);
        setAutoRotate(false);
        centerViewOnNode(id);
      } else {
        setActiveNodeId(null);
        setAutoRotate(true);
      }

      return newState;
    });
  };

  useEffect(() => {
    let rotationTimer: ReturnType<typeof setInterval>;

    if (autoRotate) {
      rotationTimer = setInterval(() => {
        setRotationAngle((prev) => {
          const newAngle = (prev + 0.1) % 360;
          return Number(newAngle.toFixed(3));
        });
      }, 50);
    }

    return () => {
      if (rotationTimer) {
        clearInterval(rotationTimer);
      }
    };
  }, [autoRotate]);

  const centerViewOnNode = (nodeId: number) => {
    if (!nodeRefs.current[nodeId]) return;

    const nodeIndex = timelineData.findIndex((item) => item.id === nodeId);
    const totalNodes = timelineData.length;
    const targetAngle = (nodeIndex / totalNodes) * 360;

    setRotationAngle(270 - targetAngle);
  };

  const calculateNodePosition = (index: number, total: number) => {
    const angle = ((index / total) * 360 + rotationAngle) % 360;
    const radius = 180;
    const radian = (angle * Math.PI) / 180;

    const x = radius * Math.cos(radian);
    const y = radius * Math.sin(radian);

    const zIndex = Math.round(100 + 50 * Math.cos(radian));
    const opacity = Math.max(0.5, Math.min(1, 0.5 + 0.5 * ((1 + Math.sin(radian)) / 2)));

    return { x, y, angle, zIndex, opacity };
  };

  const getRelatedItems = (itemId: number): number[] => {
    const currentItem = timelineData.find((item) => item.id === itemId);
    return currentItem ? currentItem.relatedIds : [];
  };

  const isRelatedToActive = (itemId: number): boolean => {
    if (!activeNodeId) return false;
    const relatedItems = getRelatedItems(activeNodeId);
    return relatedItems.includes(itemId);
  };

  const getStatusStyles = (status: TimelineItemStatus): string => {
    switch (status) {
      case "completed":
        return "text-emerald-400 bg-emerald-950/70 border-emerald-500/60";
      case "in-progress":
        return "text-cyan-400 bg-cyan-950/70 border-cyan-500/60";
      case "pending":
        return "text-slate-400 bg-slate-900/70 border-slate-600/50";
      default:
        return "text-slate-400 bg-slate-900/70 border-slate-600/50";
    }
  };

  return (
    <div
      className={`relative w-full min-h-[550px] flex flex-col items-center justify-center overflow-hidden bg-transparent ${className}`}
      ref={containerRef}
      onClick={handleContainerClick}
    >
      {/* Subtle background rings */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[420px] h-[420px] border border-slate-700/50" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[280px] h-[280px] border border-slate-700/30" />
      </div>

      <div className="relative w-full max-w-3xl h-full flex items-center justify-center">
        <div
          className="absolute w-full h-full flex items-center justify-center"
          style={{ perspective: "1000px" }}
        >
          {/* Central core */}
          <div className="absolute w-14 h-14 flex items-center justify-center z-10">
            <div className="absolute w-16 h-16 border border-cyan-400/40 rotate-45" />
            <div className="relative w-9 h-9 flex items-center justify-center bg-cyan-400">
              <div className="w-2.5 h-2.5 bg-slate-900" />
            </div>
          </div>

          {/* Orbit rings */}
          <div className="absolute w-[340px] h-[340px] border border-slate-700/60" />
          <div className="absolute w-[260px] h-[260px] border border-slate-700/40" />

          {/* Orbital nodes */}
          {timelineData.map((item, index) => {
            const position = calculateNodePosition(index, timelineData.length);
            const isExpanded = expandedItems[item.id];
            const isRelated = isRelatedToActive(item.id);
            const isHovered = hoveredNodeId === item.id;
            const Icon = item.icon;

            const nodeStyle = {
              transform: `translate(${position.x}px, ${position.y}px)`,
              zIndex: isExpanded ? 200 : position.zIndex,
              opacity: isExpanded ? 1 : position.opacity,
            };

            return (
              <div
                key={item.id}
                ref={(el) => (nodeRefs.current[item.id] = el)}
                className="absolute transition-all duration-700 cursor-pointer"
                style={nodeStyle}
                onClick={(e) => {
                  e.stopPropagation();
                  toggleItem(item.id);
                }}
                onMouseEnter={() => setHoveredNodeId(item.id)}
                onMouseLeave={() => setHoveredNodeId(null)}
              >
                {/* Node */}
                <div
                  className={`
                    w-10 h-10 flex items-center justify-center relative
                    transition-all duration-300
                    ${isExpanded ? "scale-110" : isHovered ? "scale-105" : "scale-100"}
                  `}
                >
                  {/* Background */}
                  <div 
                    className="absolute inset-0"
                    style={{
                      background: isExpanded 
                        ? '#22d3ee'
                        : isRelated || isHovered
                          ? '#0d1e35'
                          : '#0d1e35',
                      border: `2px solid ${isExpanded ? '#22d3ee' : isRelated || isHovered ? item.color : item.color + '70'}`,
                    }}
                  />

                  {/* Icon */}
                  <Icon 
                    size={16} 
                    className="relative z-10 transition-colors duration-300"
                    style={{
                      color: isExpanded 
                        ? '#0a1628' 
                        : isRelated || isHovered
                          ? '#fff'
                          : '#94a3b8'
                    }}
                  />
                </div>

                {/* Node label */}
                <div
                  className="absolute top-11 left-1/2 -translate-x-1/2 whitespace-nowrap text-[10px] font-semibold uppercase tracking-wider transition-all duration-300"
                  style={{
                    color: isExpanded ? '#22d3ee' : isHovered ? '#e2e8f0' : '#64748b'
                  }}
                >
                  {item.title}
                </div>

                {/* Expanded card */}
                {isExpanded && (
                  <Card className="absolute top-14 left-1/2 -translate-x-1/2 w-60 bg-slate-900 border-slate-600 shadow-xl overflow-visible">
                    <div className="absolute -top-3 left-1/2 -translate-x-1/2 w-px h-3 bg-slate-600" />
                    
                    <CardHeader className="pb-2">
                      <div className="flex justify-between items-center">
                        <Badge className={`px-2 text-[10px] uppercase ${getStatusStyles(item.status)}`}>
                          {item.status === "completed" ? "Active" : item.status === "in-progress" ? "Core" : "Beta"}
                        </Badge>
                        <span className="text-[10px] font-mono text-slate-500">{item.date}</span>
                      </div>
                      <CardTitle className="text-sm mt-2 text-white">{item.title}</CardTitle>
                    </CardHeader>
                    <CardContent className="text-xs text-slate-400">
                      <p>{item.content}</p>

                      {/* Energy bar */}
                      <div className="mt-4 pt-3 border-t border-slate-700">
                        <div className="flex justify-between items-center text-[10px] mb-1">
                          <span className="flex items-center text-slate-500">
                            <Zap size={10} className="mr-1" />
                            System Load
                          </span>
                          <span className="font-mono text-slate-400">{item.energy}%</span>
                        </div>
                        <div className="w-full h-1.5 bg-slate-800 overflow-hidden">
                          <div className="h-full bg-cyan-400" style={{ width: `${item.energy}%` }} />
                        </div>
                      </div>

                      {/* Connected modules */}
                      {item.relatedIds.length > 0 && (
                        <div className="mt-4 pt-3 border-t border-slate-700">
                          <div className="flex items-center mb-2">
                            <Link size={10} className="text-slate-500 mr-1" />
                            <h4 className="text-[10px] uppercase tracking-wider font-medium text-slate-500">Connected</h4>
                          </div>
                          <div className="flex flex-wrap gap-1">
                            {item.relatedIds.map((relatedId) => {
                              const relatedItem = timelineData.find((i) => i.id === relatedId);
                              return (
                                <Button
                                  key={relatedId}
                                  variant="outline"
                                  size="sm"
                                  className="flex items-center h-6 px-2 py-0 text-[10px] bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700 hover:text-white transition-all rounded-none"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    toggleItem(relatedId);
                                  }}
                                >
                                  {relatedItem?.title}
                                  <ArrowRight size={8} className="ml-1 text-slate-500" />
                                </Button>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Instructions */}
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 text-center">
        <p className="text-xs uppercase tracking-wider text-slate-600">
          Click nodes to explore • Auto-rotating
        </p>
      </div>
    </div>
  );
}

// Default timeline data for ThermoBird features
export const thermoBirdTimelineData: TimelineItem[] = [
  {
    id: 1,
    title: "Canvas",
    date: "CORE",
    content: "Visual drag-and-drop cycle builder for Rankine, Brayton, and VCR systems.",
    category: "Visual",
    icon: LayoutDashboard,
    relatedIds: [2, 3, 4],
    status: "completed",
    energy: 95,
    color: COLORS.cyan,
  },
  {
    id: 2,
    title: "Properties",
    date: "MODULE",
    content: "Real fluid property calculator with CoolProp integration. 120+ fluids.",
    category: "Analysis",
    icon: FlaskConical,
    relatedIds: [1, 5],
    status: "completed",
    energy: 88,
    color: COLORS.indigo,
  },
  {
    id: 3,
    title: "Solver",
    date: "CORE",
    content: "TBS scripting language for custom thermodynamic equation solving.",
    category: "Solver",
    icon: Terminal,
    relatedIds: [1, 4, 5],
    status: "completed",
    energy: 92,
    color: COLORS.orange,
  },
  {
    id: 4,
    title: "Results",
    date: "MODULE",
    content: "Full analysis with 1st/2nd Law, exergy destruction, T-s & P-h diagrams.",
    category: "Output",
    icon: BarChart3,
    relatedIds: [1, 3, 6],
    status: "completed",
    energy: 90,
    color: COLORS.emerald,
  },
  {
    id: 5,
    title: "Parametric",
    date: "MODULE",
    content: "Variable sweeps across ranges with automatic KPI plotting.",
    category: "Analysis",
    icon: SlidersHorizontal,
    relatedIds: [2, 3, 6],
    status: "in-progress",
    energy: 85,
    color: COLORS.amber,
  },
  {
    id: 6,
    title: "Transient",
    date: "BETA",
    content: "Real-time transient simulation with thermal mass and dynamic response.",
    category: "Advanced",
    icon: Cpu,
    relatedIds: [4, 5],
    status: "pending",
    energy: 72,
    color: COLORS.rose,
  },
];
