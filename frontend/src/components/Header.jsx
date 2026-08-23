import { Link, NavLink } from "react-router-dom";

export default function Header() {
  return (
    <header className="topbar">
      <div className="brand-block">
        <Link
          to="/browse"
          className="brand-mark"
          aria-label="Go to Shelfbound home"
        >
          S
        </Link>
        <div>
          <p className="eyebrow">Curated discovery</p>
          <h1>Shelfbound</h1>
        </div>
      </div>

      <nav className="topnav" aria-label="Main navigation">
        <NavLink
          to="/browse"
          className={({ isActive }) => `nav-link${isActive ? " active" : ""}`}
        >
          Browse
        </NavLink>
        <NavLink
          to="/staff-picks"
          className={({ isActive }) => `nav-link${isActive ? " active" : ""}`}
        >
          Staff Picks
        </NavLink>
        <NavLink
          to="/new-arrivals"
          className={({ isActive }) => `nav-link${isActive ? " active" : ""}`}
        >
          New Arrivals
        </NavLink>
      </nav>
    </header>
  );
}
