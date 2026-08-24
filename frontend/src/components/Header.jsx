import { Link, NavLink } from "react-router-dom";

const navItems = [
  { label: "Browse", to: "/browse" },
  { label: "Staff Picks", to: "/browse?tag=fantasy" },
  { label: "", to: "" },
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
        {navItems
          .filter(({ label }) => label)
          .map(({ label, to }) => (
            <NavLink
              key={label}
              to={to}
              className={({ isActive }) =>
                `nav-link${isActive ? " active" : ""}`
              }
            >
              {label}
            </NavLink>
          ))}
      </nav>
    </header>
  );
}
