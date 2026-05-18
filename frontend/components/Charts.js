"use client";
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
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
};

function CustomTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="custom-tooltip">
      <div className="label">{label}</div>
      {payload.map((entry, i) => (
        <div key={i} className="value" style={{ color: entry.color }}>
          {entry.name}: {typeof entry.value === "number" ? entry.value.toFixed(2) : entry.value}
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
