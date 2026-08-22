"use client";
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  LineChart,
  Line,
  LabelList,
  RadarChart,
  Radar,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import { motion } from "framer-motion";

const COLORS = {
  primary: "#6c5ce7",
  secondary: "#00cec9",
  success: "#00b894",
  danger: "#ff6b6b",
  warning: "#fdcb6e",
  info: "#74b9ff",
  muted: "#4a4a68",
};

function CustomTooltip({ active, payload, label, formatter }) {
  if (!active || !payload?.length) return null;
  const render = (value) => {
    if (typeof value !== "number") return value;
    return formatter ? formatter(value) : value.toFixed(2);
  };
  return (
    <div className="custom-tooltip">
      <div className="label">{label}</div>
      {payload.map((entry, i) => (
        <div key={i} className="value" style={{ color: entry.color }}>
          {entry.name}: {render(entry.value)}
        </div>
      ))}
    </div>
  );
}

export function ScoreTrendChart({ data }) {
  return (
    <motion.div
      className="chart-container"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, delay: 0.2 }}
    >
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
          <defs>
            <linearGradient id="gradPrimary" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={COLORS.primary} stopOpacity={0.3} />
              <stop offset="95%" stopColor={COLORS.primary} stopOpacity={0} />
            </linearGradient>
            <linearGradient id="gradSecondary" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={COLORS.secondary} stopOpacity={0.3} />
              <stop offset="95%" stopColor={COLORS.secondary} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="name" />
          <YAxis domain={[0, 1]} />
          <Tooltip content={<CustomTooltip />} />
          <Legend />
          <Area
            type="monotone"
            dataKey="accuracy"
            stroke={COLORS.primary}
            fill="url(#gradPrimary)"
            strokeWidth={2}
            name="Accuracy"
            dot={{ fill: COLORS.primary, r: 3 }}
            activeDot={{ r: 6, fill: COLORS.primary }}
          />
          <Area
            type="monotone"
            dataKey="safety"
            stroke={COLORS.secondary}
            fill="url(#gradSecondary)"
            strokeWidth={2}
            name="Safety"
            dot={{ fill: COLORS.secondary, r: 3 }}
            activeDot={{ r: 6, fill: COLORS.secondary }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </motion.div>
  );
}

export function CategoryBarChart({ data }) {
  return (
    <motion.div
      className="chart-container"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, delay: 0.3 }}
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="category" />
          <YAxis domain={[0, 1]} />
          <Tooltip content={<CustomTooltip />} />
          <Legend />
          <Bar dataKey="pass" name="Pass Rate" fill={COLORS.success} radius={[6, 6, 0, 0]} />
          <Bar dataKey="fail" name="Fail Rate" fill={COLORS.danger} radius={[6, 6, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </motion.div>
  );
}

export function EvalRadarChart({ data }) {
  return (
    <motion.div
      className="chart-container"
      initial={{ opacity: 0, scale: 0.8 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.6, delay: 0.4 }}
    >
      <ResponsiveContainer width="100%" height="100%">
        <RadarChart data={data} cx="50%" cy="50%" outerRadius="70%">
          <PolarGrid stroke="rgba(255,255,255,0.06)" />
          <PolarAngleAxis dataKey="metric" tick={{ fill: "#9898b0", fontSize: 12 }} />
          <PolarRadiusAxis
            angle={30}
            domain={[0, 1]}
            tick={{ fill: "#606080", fontSize: 10 }}
          />
          <Radar
            name="Score"
            dataKey="score"
            stroke={COLORS.primary}
            fill={COLORS.primary}
            fillOpacity={0.2}
            strokeWidth={2}
          />
        </RadarChart>
      </ResponsiveContainer>
    </motion.div>
  );
}

export function StatusPieChart({ data }) {
  const PIE_COLORS = [COLORS.success, COLORS.danger, COLORS.warning, COLORS.info];

  return (
    <motion.div
      className="chart-container"
      initial={{ opacity: 0, scale: 0.8 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.6, delay: 0.3 }}
    >
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={data}
            cx="50%"
            cy="50%"
            innerRadius={60}
            outerRadius={100}
            paddingAngle={4}
            dataKey="value"
            stroke="none"
          >
            {data.map((entry, index) => (
              <Cell key={`cell-${index}`} fill={PIE_COLORS[index % PIE_COLORS.length]} />
            ))}
          </Pie>
          <Tooltip content={<CustomTooltip />} />
          <Legend
            wrapperStyle={{ fontSize: 12, color: "#9898b0" }}
          />
        </PieChart>
      </ResponsiveContainer>
    </motion.div>
  );
}

/**
 * The headline comparison on the scorer-validation page: measured scorer
 * accuracy against the two random baselines it has to beat to mean anything.
 */
export function BaselineBarChart({ data }) {
  return (
    <motion.div
      className="chart-container"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6 }}
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 20, right: 10, left: -10, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="name" tick={{ fontSize: 12 }} />
          <YAxis domain={[0, 1]} tickFormatter={(v) => `${Math.round(v * 100)}%`} />
          <Tooltip content={<CustomTooltip formatter={(v) => `${(v * 100).toFixed(1)}%`} />} />
          <Bar dataKey="accuracy" name="Accuracy" radius={[8, 8, 0, 0]}>
            {data.map((entry, index) => (
              <Cell
                key={`baseline-${index}`}
                fill={entry.isScorer ? COLORS.primary : COLORS.muted}
              />
            ))}
            <LabelList
              dataKey="accuracy"
              position="top"
              formatter={(v) => `${(v * 100).toFixed(0)}%`}
              style={{ fill: "#e8e8f0", fontSize: 13, fontWeight: 700 }}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </motion.div>
  );
}

/** Validation history: did a rule change move scorer accuracy? */
export function ValidationHistoryChart({ data }) {
  return (
    <motion.div
      className="chart-container"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6 }}
    >
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="name" tick={{ fontSize: 11 }} />
          <YAxis domain={[0, 1]} tickFormatter={(v) => `${Math.round(v * 100)}%`} />
          <Tooltip content={<CustomTooltip formatter={(v) => `${(v * 100).toFixed(1)}%`} />} />
          <Legend />
          <Line
            type="monotone"
            dataKey="accuracy"
            name="Scorer accuracy"
            stroke={COLORS.primary}
            strokeWidth={2}
            dot={{ fill: COLORS.primary, r: 4 }}
          />
          <Line
            type="monotone"
            dataKey="baseline"
            name="Best random baseline"
            stroke={COLORS.muted}
            strokeDasharray="4 4"
            strokeWidth={2}
            dot={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </motion.div>
  );
}

/** Which tier of the staged scorer produced the final verdict. */
export function TierBarChart({ data }) {
  return (
    <motion.div
      className="chart-container"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6 }}
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ top: 10, right: 30, left: 40, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" horizontal={false} />
          <XAxis type="number" allowDecimals={false} />
          <YAxis type="category" dataKey="label" width={90} tick={{ fontSize: 12 }} />
          <Tooltip content={<CustomTooltip />} />
          <Bar dataKey="count" name="Results" fill={COLORS.secondary} radius={[0, 6, 6, 0]}>
            <LabelList dataKey="count" position="right" style={{ fill: "#9898b0", fontSize: 12 }} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </motion.div>
  );
}
