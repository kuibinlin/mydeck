import { useState } from "react";
import { useNavigate, useLocation } from "react-router";
import { useAuth } from "@/context/AuthContext";
import { useTheme } from "@/context/ThemeContext";
import { cn } from "@/lib/cn";
import { fireConfetti } from "@/lib/confetti";

const NAV_ITEMS = [
  { label: "Home", path: "/dashboard", icon: "fa-home" },
  { label: "Flashcards", path: "/flashcards", icon: "fa-clone" },
  { label: "Challenges", path: "/challenges", icon: "fa-bolt" },
  { label: "Leaderboard", path: "/leaderboard", icon: "fa-trophy" },
];

export default function Header() {
  const { user, logout } = useAuth();
  const { toggleTheme } = useTheme();
  const navigate = useNavigate();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);

  const isActive = (path) =>
    location.pathname === path || location.pathname.startsWith(path + "/");

  const handleLogout = async () => {
    await logout();
    navigate("/login");
  };

  const handleNav = (path) => {
    navigate(path);
    setMenuOpen(false);
  };

  return (
    <header
      className="sticky top-0 z-[100] border-b border-border"
      style={{
        background: "var(--color-bg)",
        backdropFilter: "blur(12px)",
        WebkitBackdropFilter: "blur(12px)",
      }}
    >
      <div className="max-w-6xl mx-auto px-10 py-3 flex items-center gap-2 w-full max-md:px-6">
        {/* Logo */}
        <h1
          className="text-xl font-bold cursor-pointer bg-transparent border-0 text-text p-0 mr-2 shrink-0"
          onClick={() => handleNav("/dashboard")}
        >
          <i
            className="fas fa-layer-group"
            style={{ color: "var(--color-primary)", marginRight: 6 }}
          />
          MyDeck
        </h1>

        {/* Desktop nav */}
        <nav className="flex items-center gap-0.5 flex-1 max-md:hidden">
          {NAV_ITEMS.map((item) => (
            <button
              key={item.path}
              className={cn(
                "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-transparent text-muted text-sm font-semibold cursor-pointer border-0 transition-all hover:text-text hover:bg-black/5 dark:hover:bg-white/5",
                isActive(item.path) && "text-primary! bg-primary/10!",
              )}
              onClick={() => handleNav(item.path)}
            >
              <i className={`fas ${item.icon}`} />
              {item.label}
            </button>
          ))}
        </nav>

        {/* Right side */}
        <div className="flex items-center gap-2 ml-auto">
          <button
            onClick={toggleTheme}
            title="Toggle theme"
            className="inline-flex items-center justify-center px-2.5 py-1.5 text-sm bg-transparent text-muted hover:text-text font-semibold rounded-btn transition-colors cursor-pointer border-0"
          >
            <i className="fas fa-circle-half-stroke" />
          </button>
          <button
            onClick={() => handleNav("/settings")}
            title="Settings"
            className="inline-flex items-center justify-center px-2.5 py-1.5 text-sm bg-transparent text-muted hover:text-text font-semibold rounded-btn transition-colors cursor-pointer border-0"
          >
            <i className="fas fa-gear" />
          </button>
          {user && (
            <span
              className="text-sm text-text font-medium hover:text-primary transition-colors max-md:hidden cursor-pointer select-none"
              onClick={fireConfetti}
            >
              <i className="fas fa-user" style={{ marginRight: 4 }} />
              {user.username}
            </span>
          )}
          {user && (
            <button
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-sm bg-transparent text-muted hover:text-error font-semibold rounded-btn transition-colors cursor-pointer border-0"
              onClick={handleLogout}
              title="Log out"
            >
              <i className="fas fa-sign-out-alt" />
            </button>
          )}
          <button
            className="bg-transparent border border-border text-muted w-8 h-8 rounded-input cursor-pointer hidden items-center justify-center text-sm transition-all hover:text-text hover:border-muted max-md:flex"
            onClick={() => setMenuOpen((m) => !m)}
            aria-label="Toggle menu"
          >
            <i className={`fas ${menuOpen ? "fa-times" : "fa-bars"}`} />
          </button>
        </div>
      </div>

      {/* Mobile menu */}
      {menuOpen && (
        <nav className="flex flex-col px-4 pb-3 pt-2 border-t border-border gap-0.5">
          {NAV_ITEMS.map((item) => (
            <button
              key={item.path}
              className={cn(
                "flex items-center px-3 py-2.5 rounded-lg bg-transparent text-muted text-sm font-semibold cursor-pointer border-0 transition-all w-full text-left hover:text-text hover:bg-black/5 dark:hover:bg-white/5",
                isActive(item.path) && "text-primary! bg-primary/10!",
              )}
              onClick={() => handleNav(item.path)}
            >
              <i className={`fas ${item.icon}`} style={{ marginRight: 8 }} />
              {item.label}
            </button>
          ))}
        </nav>
      )}
    </header>
  );
}
