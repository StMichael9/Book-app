import { Link, NavLink } from "react-router-dom";

const navItems = [
  { label: "Browse", to: "/browse" },
  { label: "Staff Picks", to: "/browse?tag=fantasy" },
];

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
        {navItems.map(({ label, to }) => (
          <NavLink
            key={label}
            to={to}
            className={({ isActive }) =>
              isActive ? "nav-link active" : "nav-link"
            }
          >
            {label}
          </NavLink>
        ))}
      </nav>
    </header>
  );
}
