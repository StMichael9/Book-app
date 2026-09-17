import { useEffect, useRef, useState } from "react";
import { Link, NavLink } from "react-router-dom";
import { useAuth } from "../hooks/AuthContext.jsx";

const navItems = [
  { label: "Browse", to: "/browse" },
  { label: "Staff Picks", to: "/browse?tag=fantasy" },
];

export default function Header({ theme, setTheme }) {
  const { isAuthenticated, isLoading, logout } = useAuth();
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isDrawerMounted, setIsDrawerMounted] = useState(false);
  const menuButtonRef = useRef(null);
  const drawerRef = useRef(null);
  const closeButtonRef = useRef(null);
  const drawerTimerRef = useRef(null);

  const closeMenu = () => {
    setIsMenuOpen(false);
    window.clearTimeout(drawerTimerRef.current);
    drawerTimerRef.current = window.setTimeout(() => {
      setIsDrawerMounted(false);
    }, 180);
    menuButtonRef.current?.focus();
  };

  const openMenu = () => {
    window.clearTimeout(drawerTimerRef.current);
    setIsDrawerMounted(true);
    setIsMenuOpen(true);
  };

  useEffect(() => {
    if (isMenuOpen) {
      closeButtonRef.current?.focus();
    }
  }, [isMenuOpen]);

  useEffect(() => () => window.clearTimeout(drawerTimerRef.current), []);

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (!isMenuOpen) return;

      if (event.key === "Escape") {
        event.preventDefault();
        closeMenu();
        return;
      }

      if (event.key !== "Tab" || !drawerRef.current) return;

      const focusableElements = drawerRef.current.querySelectorAll(
        "a[href], button:not([disabled])",
      );
      const firstElement = focusableElements[0];
      const lastElement = focusableElements[focusableElements.length - 1];

      if (event.shiftKey && document.activeElement === firstElement) {
        event.preventDefault();
        lastElement.focus();
      } else if (!event.shiftKey && document.activeElement === lastElement) {
        event.preventDefault();
        firstElement.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);

    const previousOverflow = document.body.style.overflow;
    if (isMenuOpen) {
      document.body.style.overflow = "hidden";
    }

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [isMenuOpen]);

  return (
    <header className="topbar">
      <div className="brand-block">
        <Link to="/" className="brand-mark" aria-label="Go to Shelfbound home">
          S
        </Link>
        <div>
          <h1>Shelfbound</h1>
        </div>
      </div>

      <button
        ref={menuButtonRef}
        type="button"
        className="mobile-menu-toggle"
        aria-expanded={isMenuOpen}
        aria-controls="mobile-navigation"
        aria-label={isMenuOpen ? "Close navigation menu" : "Open navigation menu"}
        onClick={() => {
          if (isMenuOpen) {
            closeMenu();
          } else {
            openMenu();
          }
        }}
      >
        <span aria-hidden="true">{isMenuOpen ? "Close" : "Menu"}</span>
      </button>

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
        {!isLoading && isAuthenticated ? (
          <>
            <NavLink to="/my-books" className="nav-link">
              My books
            </NavLink>
            <NavLink to="/preferences" className="nav-link">
              Preferences
            </NavLink>
            <button
              type="button"
              className="nav-link nav-button"
              onClick={logout}
            >
              Log out
            </button>
          </>
        ) : !isLoading ? (
          <>
            <NavLink to="/login" className="nav-link">
              Sign in
            </NavLink>
            <NavLink to="/register" className="nav-link active">
              Join Shelfbound
            </NavLink>
          </>
        ) : null}
      </nav>

      {isDrawerMounted && (
        <div
          className={`mobile-drawer-layer${isMenuOpen ? "" : " is-closing"}`}
          aria-hidden={!isMenuOpen}
        >
          <button
            type="button"
            className="mobile-drawer-backdrop"
            aria-label="Close navigation menu"
            onClick={closeMenu}
          />
          <aside
            ref={drawerRef}
            id="mobile-navigation"
            className="mobile-drawer"
            inert={!isMenuOpen}
            aria-label="Mobile navigation"
          >
            <div className="mobile-drawer__header">
              <p className="mobile-drawer__title">Menu</p>
              <button
                ref={closeButtonRef}
                type="button"
                className="mobile-drawer__close"
                aria-label="Close navigation menu"
                onClick={closeMenu}
              >
                <span aria-hidden="true">&times;</span>
              </button>
            </div>

            <nav className="mobile-drawer__nav" aria-label="Mobile navigation">
              <section className="mobile-drawer__section" aria-labelledby="drawer-explore">
                <h2 id="drawer-explore">Explore</h2>
                {navItems.map(({ label, to }) => (
                  <NavLink
                    key={label}
                    to={to}
                    className={({ isActive }) =>
                      isActive
                        ? "mobile-drawer__link active"
                        : "mobile-drawer__link"
                    }
                    onClick={closeMenu}
                  >
                    {label}
                  </NavLink>
                ))}
              </section>

              {!isLoading && isAuthenticated && (
                <section className="mobile-drawer__section" aria-labelledby="drawer-shelf">
                  <h2 id="drawer-shelf">Your shelf</h2>
                  <NavLink
                    to="/my-books"
                    className="mobile-drawer__link"
                    onClick={closeMenu}
                  >
                    My books
                  </NavLink>
                  <NavLink
                    to="/preferences"
                    className="mobile-drawer__link"
                    onClick={closeMenu}
                  >
                    Preferences
                  </NavLink>
                </section>
              )}

              <section className="mobile-drawer__section" aria-labelledby="drawer-account">
                <h2 id="drawer-account">Account</h2>
                <button
                  type="button"
                  className="mobile-drawer__link mobile-drawer__button"
                  onClick={() =>
                    setTheme((current) =>
                      current === "light" ? "dark" : "light",
                    )
                  }
                >
                  {theme === "light" ? "Warm dark" : "Vintage light"}
                </button>
                {!isLoading && isAuthenticated ? (
                  <button
                    type="button"
                    className="mobile-drawer__link mobile-drawer__button"
                    onClick={() => {
                      logout();
                      closeMenu();
                    }}
                  >
                    Log out
                  </button>
                ) : !isLoading ? (
                  <>
                    <NavLink
                      to="/login"
                      className="mobile-drawer__link"
                      onClick={closeMenu}
                    >
                      Sign in
                    </NavLink>
                    <NavLink
                      to="/register"
                      className="mobile-drawer__link active"
                      onClick={closeMenu}
                    >
                      Join Shelfbound
                    </NavLink>
                  </>
                ) : null}
              </section>
            </nav>
          </aside>
        </div>
      )}
    </header>
  );
}
