"use client";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { motion } from "framer-motion";

const navItems = [
  { label: "Overview", path: "/", icon: "📊" },
  { label: "Eval Runs", path: "/runs", icon: "🧪" },
  { label: "Run Suite", path: "/suite", icon: "🚀" },
  { label: "New Eval", path: "/eval", icon: "⚡" },
  { label: "Compare", path: "/compare", icon: "🔀" },
];

const harnessItems = [
  { label: "Scorer Validation", path: "/scorer-validation", icon: "🔬" },
];

export default function Sidebar() {
  const pathname = usePathname();

  return (
    <motion.aside
      className="sidebar"
      initial={{ x: -260 }}
      animate={{ x: 0 }}
      transition={{ type: "spring", stiffness: 300, damping: 30 }}
    >
      <div className="sidebar-logo">
        <div className="sidebar-logo-icon">🧠</div>
        <span className="sidebar-logo-text">LLM Eval</span>
        <span className="sidebar-logo-badge">v2</span>
      </div>

      <nav className="sidebar-nav">
        <div className="nav-section-label">Main</div>
        {navItems.map((item) => (
          <Link
            key={item.path}
            href={item.path}
            className={`nav-link ${pathname === item.path ? "active" : ""}`}
          >
            <span className="nav-link-icon">{item.icon}</span>
            {item.label}
          </Link>
        ))}

        <div className="nav-section-label">Harness</div>
        {harnessItems.map((item) => (
          <Link
            key={item.path}
            href={item.path}
            className={`nav-link ${pathname === item.path ? "active" : ""}`}
          >
            <span className="nav-link-icon">{item.icon}</span>
            {item.label}
          </Link>
        ))}

        <div className="nav-section-label" style={{ marginTop: "auto" }}>
          System
        </div>
        <div className="nav-link" style={{ cursor: "default" }}>
          <span className="nav-link-icon">🟢</span>
          <span className="live-indicator">
            <span className="live-dot"></span>
            API Connected
          </span>
        </div>
      </nav>
    </motion.aside>
  );
}
