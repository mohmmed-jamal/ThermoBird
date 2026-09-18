# Plan 01 — Frontend Reconstruction (Research-Enhanced)

> **Goal:** Reconstruct the ThermoBird frontend to be clean, sharp, premium, and aligned with modern engineering software standards — with richer natural colours, proper design tokens, consistent typography, and polished UX across every tab and component.

---

## 1  Current-State Assessment

### What Already Works Well
| Strength | Detail |
|----------|--------|
| **Design-token architecture** | All colours, shadows, borders use `--tb-*` CSS custom properties |
| **Dark ↔ Light toggle** | Two complete token sets (`html.dark`, `html.light`) — values need enriching |
| **Typography foundation** | Headings use *Outfit*, body uses *Inter* — solid hierarchy, under-leveraged |
| **Framer Motion** | Page transitions, tab indicators use spring physics — can be extended |
| **Component structure** | Each tab is standalone with Zustand stores — changes are local and safe |

### Critical Pain Points Identified
| Issue | Location | Impact |
|-------|----------|--------|
| **Flat, desaturated colours** | Dark mode is uniform navy without warmth; Light mode is washed-out | Visual fatigue, lacks premium feel |
| **Hard-coded font sizes** | TransientPanel uses `style={{ fontSize: 11 }}` inline | Inconsistent typography |
| **Transient tab is weakest** | Wall of numeric inputs; small charts (280px); no zoom/interaction | Poor UX for key feature |
| **Parameter name mismatch** | Store uses `Q_dot_kW`, backend expects `UA_source` | Silent failures |
| **No skeleton/loading states** | `.tb-skeleton` defined but never used | Perceived performance issues |
| **No responsive strategy** | 320px sidebar doesn't collapse on mobile | Mobile unusable |

---

## 2  Research-Informed Design Direction

Based on analysis of Linear.app, Vercel, GitHub, Shapr3D, and modern CAD/CAE tools:

### 2.1  Modern Engineering Software UX Patterns

**From Linear, Vercel, Figma:**
- **Dark gray backgrounds** (#121212) instead of pure black — reduces eye strain
- **Edge lighting** for depth instead of shadows (Linear's signature)
- **Desaturated accent colors** in dark mode (vivid colors jar on dark)
- **Command palette** (Cmd+K) for power users
- **Progressive disclosure** — hide complexity until needed

**From Shapr3D (Apple Design Award):**
- Right-click context menus — tools appear when needed
- Adaptive UI that delivers contextually
- Simplified toolbars with most-used actions

**From Onshape/Fusion 360:**
- Cloud-first, real-time collaboration indicators
- Persistent context panes
- Touch-friendly controls with haptic feedback

### 2.2  Scientific Visualization Best Practices

- **F-pattern layout** — most important info top-left
- **5-7 KPIs maximum** per view
- **Real-time data streaming** indicators
- **Sparklines** for compact trends
- **Data freshness badges** ("Updated 2s ago")

---

## 3  Enhanced Design System

### 3.1  Enriched Colour Palette

**Dark Mode** — Layered, warm-tinted dark palette:

```css
/* Core backgrounds — deeper, slightly warm */
--tb-bg-base:        #0a0f1a;   /* was #08111e — deeper near-black */
--tb-bg-surface:     #111b2b;   /* was #0e1c2e — warmer navy */
--tb-bg-elevated:    #182640;   /* was #162035 — richer blue */
--tb-bg-deep:        #070b14;   /* NEW — for canvas/workspace areas */
--tb-bg-inset:       #0d1420;   /* NEW — for input backgrounds */

/* Text — slightly warmer for comfort */
--tb-text-primary:   #e8eef5;   /* was #e2eaf5 */
--tb-text-secondary: #8ba3c7;   /* was #7fa3c0 */
--tb-text-muted:     #4a5d78;   /* was #3e5a72 */

/* Accent palette — richer vibrancy */
--tb-accent:         #0ea5e9;   /* keep — iconic */
--tb-accent-warm:    #38bdf8;   /* lighter hover accent */
--tb-accent-ice:     #7dd3fc;   /* chart highlights */
--tb-accent-subtle:  rgba(14,165,233,0.12);  /* was 0.09 */
--tb-accent-glow:    rgba(14,165,233,0.28);  /* was 0.22 */

/* Semantic colors — desaturated for dark mode */
--tb-gold:           #f5a623;   /* was #f59e0b — warmer amber */
--tb-emerald:        #34d399;   /* was #10b981 — brighter success */
--tb-rose:           #fb7185;   /* was #f43f5e — softer error */
--tb-violet:         #a78bfa;   /* was #818cf8 — richer secondary */
--tb-orange:         #fb923c;   /* NEW — warnings */

/* Borders — more visible */
--tb-border:         rgba(255,255,255,0.10);  /* was 0.08 */
--tb-border-soft:    rgba(255,255,255,0.05);  /* was 0.04 */
```

**Light Mode** — Brighter and warmer, not clinical:

```css
/* Warm neutral mid-tones */
--tb-bg-base:        #f4f5f7;   /* was #e8ecf2 — pure light, warm */
--tb-bg-surface:     #ffffff;   /* was #f0f3f8 — paper-white */
--tb-bg-elevated:    #ebedf2;   /* was #dde2eb — warmer off-white */
--tb-bg-deep:        #f0f1f5;   /* NEW — for workspace areas */
--tb-bg-inset:       #f8f9fb;   /* NEW — for inputs */

/* Text — deep navy for contrast */
--tb-text-primary:   #1a2332;   /* was #1b2d47 */
--tb-text-secondary: #3d4f66;   /* was #334d6e */
--tb-text-muted:     #6b7d99;   /* was #6b80a0 */

/* Accent — slightly brighter, Apple-esque */
--tb-accent:         #0072c6;   /* was #005fa3 */
--tb-accent-hover:   #0088e6;   /* NEW */
--tb-accent-subtle:  rgba(0,114,198,0.10);   /* was 0.08 */

/* Semantic — keep saturation moderate */
--tb-gold:           #b45309;   /* was #a05c00 */
--tb-emerald:        #15803d;   /* unchanged */
--tb-rose:           #dc2626;   /* unchanged */
```

### 3.2  Typography Scale (Replace All Inline Styles)

| Token Class | Size | Line Height | Weight | Usage |
|-------------|------|-------------|--------|-------|
| `.tb-text-2xs` | 10px | 1.4 | 500 | Badges, labels, muted meta |
| `.tb-text-xs` | 12px | 1.5 | 400 | Input labels, secondary text |
| `.tb-text-sm` | 13px | 1.5 | 400 | Body text, parameter names |
| `.tb-text-base` | 14px | 1.5 | 500 | Panel titles, section headers |
| `.tb-text-lg` | 16px | 1.4 | 600 | Card headings |
| `.tb-text-xl` | 20px | 1.3 | 700 | Page titles, KPI values |
| `.tb-text-2xl` | 28px | 1.2 | 700 | Hero numbers (efficiency %) |

**Font Features:**
```css
/* Tabular numbers for data alignment */
.tb-tabular { font-variant-numeric: tabular-nums; }

/* Monospace for values */
.tb-mono { 
  font-family: 'JetBrains Mono', 'Fira Code', monospace;
  font-feature-settings: 'tnum' on, 'zero' on;
}
```

### 3.3  Spacing & Layout System

```css
/* 8px grid system */
--tb-space-1: 4px;
--tb-space-2: 8px;
--tb-space-3: 12px;
--tb-space-4: 16px;
--tb-space-5: 24px;
--tb-space-6: 32px;
--tb-space-8: 48px;

/* Border radius scale */
--tb-radius-sm: 6px;
--tb-radius-md: 10px;
--tb-radius-lg: 14px;
--tb-radius-xl: 20px;
```

---

## 4  Component-Level Redesign

### 4.1  TransientPanel (Highest Priority)

**Left Sidebar — Component Configuration:**

```
┌─────────────────────────────────────────┐
│ ⚡ Transient Config              [Reset]│
├─────────────────────────────────────────┤
│ ┌─────────────────────────────────────┐ │
│ │ Simulation Settings          [v]    │ │  ← Collapsible card
│ │                                     │ │
│ │  Fluid          [Water ▼]           │ │
│ │  Duration       [600    ] s         │ │
│ │  Output points  [300    ] pts       │ │
│ │  Dead-state T₀  [298.15 ] K         │ │
│ └─────────────────────────────────────┘ │
│                                         │
│ COMPONENTS (4)                          │
│                                         │
│ ┌─────────────────────────────────────┐ │
│ │ 🔥 Boiler                    [v]    │ │  ← Color-coded header
│ │ ─────────────────────────────────── │ │
│ │ Parameters                          │ │
│ │  Heat input        [5000  ] kW      │ │
│ │  UA (heat transfer)[50    ] kW/K    │ │
│ │  ...                                │ │
│ │ ─────────────────────────────────── │ │
│ │ Initial Conditions (t = 0)          │ │
│ │  Fluid T₀          [320   ] K       │ │
│ │  Wall T₀           [330   ] K       │ │
│ └─────────────────────────────────────┘ │
│                                         │
│ ┌─────────────────────────────────────┐ │
│ │ 💨 Turbine                   [>]    │ │  ← Collapsed
│ └─────────────────────────────────────┘ │
│ ...                                     │
│                                         │
│ ┌─────────────────────────────────────┐ │
│ │ ⚙️ Solver Tolerances         [v]    │ │
│ │  rtol  [0.0001 ]                    │ │
│ │  atol  [0.000001]                   │ │
│ └─────────────────────────────────────┘ │
└─────────────────────────────────────────┘
```

**Changes:**
1. **Section header strip** with faint accent tint per component type:
   - Boiler: warm amber left border (3px)
   - Turbine: blue left border
   - Condenser: indigo left border
   - Pump: emerald left border

2. **Simulation Settings card** with subtle gradient top-border

3. **Widen sidebar** from 320px → 360px for better breathing room

4. **Replace hard-coded inputs** with consistent `.tb-input` class

5. **Add parameter search/filter** for components with many parameters

**Right Panel — Run Area:**

```
┌──────────────────────────────────────────────────────────┐
│                                                          │
│     ┌──────────────────────────────────────────┐         │
│     │  [Animated cycle diagram]                │         │
│     │  Boiler → Turbine → Condenser → Pump     │         │  ← NEW
│     │  (Working fluid flow animation)          │         │
│     └──────────────────────────────────────────┘         │
│                                                          │
│     ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐                     │
│     │Water│ │ 4   │ │600s │ │Radau│                     │  ← NEW
│     │     │ │comp │ │     │ │     │                     │  ← Micro stat badges
│     └─────┘ └─────┘ └─────┘ └─────┘                     │
│                                                          │
│     ┌──────────────────────────────────────────┐         │
│     │                                          │         │
│     │   [✓] First & second law simultaneously  │         │
│     │   [✓] Entropy generation tracking        │         │
│     │   [✓] Exergy destruction analysis        │         │
│     │   [✓] Full startup transient             │         │
│     │                                          │         │
│     └──────────────────────────────────────────┘         │
│                                                          │
│              ┌────────────────────┐                      │
│              │  ▶ Run Simulation  │                      │  ← Larger, centered
│              │     (5-30s)        │                      │
│              └────────────────────┘                      │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

**Changes:**
1. **Animated cycle diagram** — SVG with Framer Motion path drawing
2. **Micro stat badges** — Fluid, component count, duration, solver
3. **Larger Run button** — Centered, prominent, with ripple animation
4. **Feature checklist** — Visual confirmation of capabilities

### 4.2  TransientResults — Chart Overhaul

**Current Issues:**
- Charts are only 280px tall
- No zoom/pan capability
- No comparison mode
- No real-time updates

**New Design:**

```
┌─────────────────────────────────────────────────────────────────────┐
│ ⚡ Transient Results    [Export CSV] [Clear]    500 pts · 1.2s · 12K │
├─────────────────────────────────────────────────────────────────────┤
│ ┌────────────┐ ┌────────────┐ ┌────────────┐ ┌────────────┐        │
│ │ η_thermal  │ │ η_exergy   │ │ W_net      │ │ Ṡ_gen      │        │  ← Stat cards
│ │   42.3%    │ │   38.7%    │ │  125.4 kW  │ │ 0.45 kW/K  │        │
│ └────────────┘ └────────────┘ └────────────┘ └────────────┘        │
├─────────────────────────────────────────────────────────────────────┤
│ [Energy ▼] [Entropy] [Exergy] [Temperature] [Raw Data]     [⚙️]    │  ← Sub-tabs
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│   Thermal & Exergy Efficiency vs Time                    [🔍+]     │
│   ┌─────────────────────────────────────────────────────────┐      │
│   │                                              ╭────╮     │      │
│   │    ╭────╮                                   ╱      ╲    │      │
│   │   ╱     ╲        ╭─────────────────────────╱        ╲   │      │
│   │  ╱       ╲──────╱                                     ╲  │ 360px│
│   │ ╱                                                      ╲ │ tall │
│   └─────────────────────────────────────────────────────────┘      │
│   0s    100s    200s    300s    400s    500s    600s                │
│                                                                     │
│   [█░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░] ← Brush  │
│   0s                                              600s              │
│                                                                     │
│   ┌─────────────────────────────────────────────────────────┐      │
│   │ 💡 Steady-state thermal efficiency ≈ 42.3%. The gap to  │      │  ← Insight
│   │    the Carnot limit reflects irreversibilities...       │      │
│   └─────────────────────────────────────────────────────────┘      │
│                                                                     │
│   Net Power & Heat Input vs Time                         [⬆️⬇️]    │
│   ┌─────────────────────────────────────────────────────────┐      │
│   │                                                         │      │
│   │                              ╭────────────────────────  │      │
│   │    ╭────╮                   ╱                           │      │
│   │   ╱     ╲──────────────────╱                            │      │
│   └─────────────────────────────────────────────────────────┘      │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

**Changes:**
1. **Chart height** 280px → 360px
2. **Zoom/pan** via Recharts `Brush` component
3. **Comparison mode** toggle to overlay previous runs (dashed lines)
4. **Real-time updates** via WebSocket/SSE
5. **Stat cards with count-up animation** using Framer Motion
6. **Insight cards** with colored left border accent
7. **Export options** — CSV (existing), JSON, PDF report

### 4.3  Global Components

**Dashboard Header:**
```
┌─────────────────────────────────────────────────────────────────────┐
│ 🐦 ThermoBird                                        [🌙] [Save ▼] 👤│
│ ─────────────────────────────────────────────────────────────────── │  ← Subtle gradient line
│ [Canvas] [Results] [Transient ⚡] [Properties] [Solver]      [▶ Run] │  ← Thicker active indicator (3px)
└─────────────────────────────────────────────────────────────────────┘
```

**Changes:**
1. **Gradient border glow** at bottom (1px gradient, not full border)
2. **Brand shimmer** on hover
3. **Thicker active tab indicator** (3px) with faint track line
4. **Command palette trigger** (Cmd+K) for quick actions

**Loading States:**
```css
/* Skeleton for charts */
.tb-chart-skeleton {
  background: linear-gradient(
    90deg,
    var(--tb-bg-elevated) 0%,
    rgba(255,255,255,0.03) 50%,
    var(--tb-bg-elevated) 100%
  );
  background-size: 1000px 100%;
  animation: tb-shimmer 2s ease-in-out infinite;
}

/* Pulse for live data */
.tb-live-indicator {
  width: 8px;
  height: 8px;
  background: var(--tb-emerald);
  border-radius: 50%;
  animation: tb-pulse 2s ease-in-out infinite;
}
```

---

## 5  Responsive Design

### Breakpoints

| Breakpoint | Width | Changes |
|------------|-------|---------|
| `sm` | ≤ 640px | Stack everything, bottom sheet for config |
| `md` | ≤ 768px | Collapse sidebar to icon-only tabs |
| `lg` | ≤ 1024px | Two-column layout, reduced padding |
| `xl` | > 1024px | Full layout as designed |

### Mobile-Specific Patterns

**TransientPanel on Mobile:**
```
┌─────────────────────────┐
│ ⚡ Transient        [≡] │  ← Hamburger for config
├─────────────────────────┤
│                         │
│   [Animated cycle]      │
│                         │
│   [Run Simulation]      │
│                         │
├─────────────────────────┤
│ [Chart 1]               │  ← Full-width cards
├─────────────────────────┤
│ [Chart 2]               │
├─────────────────────────┤
│ ...                     │
└─────────────────────────┘

Bottom Sheet (slides up):
┌─────────────────────────┐
│ ─── Drag handle ───     │
│ Components              │
│ ┌─────────────────────┐ │
│ │ 🔥 Boiler      [v]  │ │
│ │ ...                 │ │
│ └─────────────────────┘ │
│ ...                     │
└─────────────────────────┘
```

---

## 6  Accessibility (WCAG 2.2 AA)

### Requirements
- [ ] **Contrast ratios**: 4.5:1 for normal text, 3:1 for large text
- [ ] **Focus indicators**: 2px minimum, 3:1 contrast against background
- [ ] **Keyboard navigation**: All interactive elements accessible via Tab
- [ ] **Screen reader support**: ARIA labels for charts, live regions for updates
- [ ] **Reduced motion**: Respect `prefers-reduced-motion` for animations
- [ ] **Touch targets**: Minimum 44x44px for mobile

### Implementation
```tsx
// Focus visible outline
*:focus-visible {
  outline: 2px solid var(--tb-accent);
  outline-offset: 2px;
}

// Screen reader only text
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  border: 0;
}
```

---

## 7  Implementation Priority

| Phase | Scope | Effort | Dependencies |
|-------|-------|--------|--------------|
| **Phase 1** | CSS token overhaul (colours, typography, spacing) | ½ day | None |
| **Phase 2** | TransientPanel redesign (sidebar, run area) | 1 day | Phase 1 |
| **Phase 3** | TransientResults overhaul (charts, zoom, animations) | 1 day | Phase 2 |
| **Phase 4** | Dashboard header, global components | ½ day | Phase 1 |
| **Phase 5** | Responsive breakpoints, mobile views | ½ day | Phase 2-4 |
| **Phase 6** | Accessibility audit, keyboard nav | ½ day | All above |
| **Phase 7** | Skeleton loaders, micro-animations | ½ day | Phase 1 |

**Total estimated effort: ~4.5 days**

---

## 8  Verification Checklist

| What | How |
|------|-----|
| Visual regression | Side-by-side screenshots before/after (dark + light) at 1440px and 768px |
| Token coverage | `grep -r "fontSize:" src/` should return zero inline overrides |
| Contrast ratio | Use axe-core or Lighthouse — all text must pass WCAG AA |
| Build sanity | `npm run build` succeeds with zero TypeScript errors |
| Theme toggle | Rapid dark ↔ light toggle never produces flash of wrong colours |
| Keyboard nav | Tab through entire Transient panel without mouse |
| Screen reader | NVDA/VoiceOver announces chart data correctly |

---

## 9  Design Tokens Reference

```typescript
// tokens.ts — Single source of truth
export const tokens = {
  color: {
    background: {
      base: { light: '#f4f5f7', dark: '#0a0f1a' },
      surface: { light: '#ffffff', dark: '#111b2b' },
      elevated: { light: '#ebedf2', dark: '#182640' },
      deep: { light: '#f0f1f5', dark: '#070b14' },
      inset: { light: '#f8f9fb', dark: '#0d1420' },
    },
    text: {
      primary: { light: '#1a2332', dark: '#e8eef5' },
      secondary: { light: '#3d4f66', dark: '#8ba3c7' },
      muted: { light: '#6b7d99', dark: '#4a5d78' },
    },
    accent: {
      DEFAULT: { light: '#0072c6', dark: '#0ea5e9' },
      hover: { light: '#0088e6', dark: '#38bdf8' },
      subtle: { light: 'rgba(0,114,198,0.10)', dark: 'rgba(14,165,233,0.12)' },
    },
    semantic: {
      success: { light: '#15803d', dark: '#34d399' },
      warning: { light: '#b45309', dark: '#fb923c' },
      error: { light: '#dc2626', dark: '#fb7185' },
    },
  },
  space: {
    1: '4px', 2: '8px', 3: '12px', 4: '16px',
    5: '24px', 6: '32px', 8: '48px',
  },
  radius: {
    sm: '6px', md: '10px', lg: '14px', xl: '20px',
  },
  font: {
    sans: "'Inter', system-ui, sans-serif",
    display: "'Outfit', 'Inter', sans-serif",
    mono: "'JetBrains Mono', 'Fira Code', monospace",
  },
};
```
