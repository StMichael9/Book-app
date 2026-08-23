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
      </nav>
    </header>
  );
}
