import "./globals.css";
import Sidebar from "@/components/Sidebar";

export const metadata = {
  title: "LLM Eval Dashboard — AI Model Testing & Analysis",
  description:
    "Enterprise-grade LLM evaluation dashboard. Run test suites, track model accuracy, safety scores, and detect regressions across AI models.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <div className="bg-orb bg-orb-1" />
        <div className="bg-orb bg-orb-2" />
        <div className="app-layout">
          <Sidebar />
          <main className="main-content">
            <div className="mobile-brand">
              <div className="sidebar-logo-icon">🧠</div>
              <span className="sidebar-logo-text">LLM Eval</span>
              <span className="sidebar-logo-badge">v1</span>
            </div>
            {children}
          </main>
        </div>
      </body>
    </html>
  );
}
