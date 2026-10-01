import { BarChart3, Compass, Download, Languages, Moon, Music2, Sun, type LucideIcon } from "lucide-react";
import { appCopy, type UiLanguage } from "../uiLanguage";
import { SlidingIndicator } from "./SlidingIndicator";

export type AppPage = "translate" | "stats" | "media" | "discover" | "downloaded";
export type AppTheme = "light" | "dark";

const NAV_ITEMS: Array<{ page: AppPage; Icon: LucideIcon }> = [
  { page: "discover", Icon: Compass },
  { page: "downloaded", Icon: Download },
  { page: "translate", Icon: Languages },
  { page: "media", Icon: Music2 },
  { page: "stats", Icon: BarChart3 }
];

const COPY_KEYS: Record<AppPage, keyof (typeof appCopy)["en"]["navigation"]> = {
  discover: "discover",
  downloaded: "downloaded",
  translate: "translate",
  media: "media",
  stats: "stats"
};

interface AppSidebarProps {
  activePage: AppPage;
  uiLanguage: UiLanguage;
  theme: AppTheme;
  logoUrl: string;
  onNavigate: (page: AppPage) => void;
  onToggleLanguage: () => void;
  /** Receives the switch centre so the theme change can spread out from it. */
  onToggleTheme: (origin: { x: number; y: number }) => void;
}

export function AppSidebar({
  activePage,
  uiLanguage,
  theme,
  logoUrl,
  onNavigate,
  onToggleLanguage,
  onToggleTheme
}: AppSidebarProps) {
  const copy = appCopy[uiLanguage];

  return (
    <aside className="app-sidebar">
      <div className="brand">
        <span className="brand-logo" aria-hidden="true">
          <img src={logoUrl} alt="" draggable={false} />
        </span>
        <div className="brand-copy">
          <h1>SubsTranslate</h1>
          <span>{copy.brandSubtitle}</span>
        </div>
      </div>

      <nav className="app-nav" aria-label={copy.mainPages}>
        <SlidingIndicator variant="nav" />
        <span className="sidebar-label">{copy.workspace}</span>
        {NAV_ITEMS.map(({ page, Icon }) => {
          const [label, description] = copy.navigation[COPY_KEYS[page]];
          const active = activePage === page;
          return (
            <button
              aria-current={active ? "page" : undefined}
              aria-label={label}
              className={`nav-item${active ? " active" : ""}`}
              key={page}
              onClick={() => onNavigate(page)}
              title={description}
              type="button"
            >
              <Icon aria-hidden="true" size={18} />
              <span className="nav-label">{label}</span>
            </button>
          );
        })}
      </nav>

      <div className="sidebar-footer">
        <button
          aria-checked={uiLanguage === "bg"}
          aria-label={uiLanguage === "bg" ? "Режим на български" : "Bulgarian mode"}
          className="sidebar-switch"
          onClick={onToggleLanguage}
          role="switch"
          title={copy.languageMode}
          type="button"
        >
          <span className="sidebar-switch-icon language-badge" aria-hidden="true">БГ</span>
          <span className="sidebar-switch-label">{copy.languageMode}</span>
          <span className="switch-track" aria-hidden="true"><span /></span>
        </button>
        <button
          aria-checked={theme === "dark"}
          aria-label={copy.darkTheme}
          className="sidebar-switch"
          onClick={(event) => {
            const bounds = event.currentTarget.getBoundingClientRect();
            onToggleTheme({ x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 });
          }}
          role="switch"
          title={copy.darkTheme}
          type="button"
        >
          <span className="sidebar-switch-icon" aria-hidden="true">
            {theme === "dark" ? <Moon size={15} /> : <Sun size={15} />}
          </span>
          <span className="sidebar-switch-label">{copy.darkTheme}</span>
          <span className="switch-track" aria-hidden="true"><span /></span>
        </button>
      </div>
    </aside>
  );
}
