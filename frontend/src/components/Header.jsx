import { useEffect, useRef, useState } from "react";
import { Link, NavLink } from "react-router-dom";
import { Menu, Moon, Sun, UserRound, X } from "lucide-react";
import { useAuth } from "../hooks/AuthContext.jsx";

const navItems = [{ label: "Browse", to: "/browse" }];

export default function Header({
  theme,
  setTheme,
  onOpenPreferences,
  onClosePreferences,
}) {
  const { isAuthenticated, isLoading, logout } = useAuth();
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isDrawerMounted, setIsDrawerMounted] = useState(false);
  const [isAccountOpen, setIsAccountOpen] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [logoutError, setLogoutError] = useState("");
  const menuButtonRef = useRef(null);
  const drawerRef = useRef(null);
  const closeButtonRef = useRef(null);
  const drawerTimerRef = useRef(null);
  const accountButtonRef = useRef(null);
  const accountMenuRef = useRef(null);
  const accountItemRef = useRef(null);

  const handleLogout = async () => {
    if (isLoggingOut) return;

    setIsLoggingOut(true);
    setLogoutError("");
    try {
      await logout();
      setIsAccountOpen(false);
      closeMenu({ immediate: true, restoreFocus: false });
      onClosePreferences();
    } catch (error) {
      setLogoutError(error.message || "Unable to log out right now.");
    } finally {
      setIsLoggingOut(false);
    }
  };

  const closeMenu = ({ immediate = false, restoreFocus = true } = {}) => {
    setIsMenuOpen(false);
    window.clearTimeout(drawerTimerRef.current);
    const unmountDrawer = () => {
      setIsDrawerMounted(false);
    };
    if (immediate) {
      unmountDrawer();
    } else {
      drawerTimerRef.current = window.setTimeout(unmountDrawer, 180);
    }
    if (restoreFocus) menuButtonRef.current?.focus();
  };

  const openMenu = () => {
    setIsAccountOpen(false);
    onClosePreferences();
    window.clearTimeout(drawerTimerRef.current);
    setIsDrawerMounted(true);
    setIsMenuOpen(true);
  };

  const closeAccountMenu = (restoreFocus = true) => {
    setIsAccountOpen(false);
    if (restoreFocus) accountButtonRef.current?.focus();
  };

  const openAccountMenu = () => {
    onClosePreferences();
    setIsAccountOpen(true);
  };

  useEffect(() => {
    if (isMenuOpen) {
      closeButtonRef.current?.focus();
    }
  }, [isMenuOpen]);

  useEffect(() => () => window.clearTimeout(drawerTimerRef.current), []);

  useEffect(() => {
    if (isAccountOpen) accountItemRef.current?.focus();
  }, [isAccountOpen]);

  useEffect(() => {
    if (!isAuthenticated) {
      setIsAccountOpen(false);
      closeMenu({ immediate: true, restoreFocus: false });
    }
  }, [isAuthenticated]);

  useEffect(() => {
    if (!isAccountOpen) return undefined;

    const handlePointerDown = (event) => {
      if (!accountMenuRef.current?.contains(event.target)) {
        closeAccountMenu(false);
      }
    };

    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeAccountMenu();
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isAccountOpen]);

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
        <Link to="/" className="brand-mark" aria-label="Go to Bookvane home">
          <img src="/bookvane-logo.png" alt="Bookvane" />
        </Link>
      </div>

      <button
        ref={menuButtonRef}
        type="button"
        className="mobile-menu-toggle"
        aria-expanded={isMenuOpen}
        aria-controls="mobile-navigation"
        aria-label={
          isMenuOpen ? "Close navigation menu" : "Open navigation menu"
        }
        onClick={() => {
          if (isMenuOpen) {
            closeMenu();
          } else {
            openMenu();
          }
        }}
      >
        {isMenuOpen ? (
          <X aria-hidden="true" size={19} />
        ) : (
          <Menu aria-hidden="true" size={19} />
        )}
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

      <div className="topbar-actions">
        <button
          type="button"
          className="theme-toggle"
          onClick={() =>
            setTheme((current) => (current === "light" ? "dark" : "light"))
          }
          aria-label={
            theme === "light" ? "Switch to dark mode" : "Switch to light mode"
          }
          title={
            theme === "light" ? "Switch to dark mode" : "Switch to light mode"
          }
        >
          {theme === "light" ? (
            <Sun aria-hidden="true" size={19} />
          ) : (
            <Moon aria-hidden="true" size={19} />
          )}
        </button>
        {!isLoading && isAuthenticated && (
          <div ref={accountMenuRef} className="account-menu">
            <button
              ref={accountButtonRef}
              type="button"
              className="icon-button"
              aria-label="Open account menu"
              title="Account"
              aria-haspopup="menu"
              aria-expanded={isAccountOpen}
              onClick={() =>
                isAccountOpen ? closeAccountMenu() : openAccountMenu()
              }
            >
              <UserRound aria-hidden="true" size={19} />
            </button>
            {isAccountOpen && (
              <div className="account-menu__popover" role="menu">
                <button
                  ref={accountItemRef}
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    closeAccountMenu(false);
                    onOpenPreferences(accountButtonRef.current);
                  }}
                >
                  Preferences
                </button>
                <button
                  type="button"
                  role="menuitem"
                  disabled={isLoggingOut}
                  onClick={handleLogout}
                >
                  {isLoggingOut ? "Logging out…" : "Log out"}
                </button>
              </div>
            )}
          </div>
        )}
      </div>

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
                <X aria-hidden="true" size={19} />
              </button>
            </div>

            <nav className="mobile-drawer__nav" aria-label="Mobile navigation">
              <section
                className="mobile-drawer__section"
                aria-labelledby="drawer-explore"
              >
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
                <section
                  className="mobile-drawer__section"
                  aria-labelledby="drawer-shelf"
                >
                  <h2 id="drawer-shelf">Your shelf</h2>
                  <NavLink
                    to="/my-books"
                    className="mobile-drawer__link"
                    onClick={closeMenu}
                  >
                    My books
                  </NavLink>
                </section>
              )}
            </nav>
          </aside>
        </div>
      )}
      {logoutError && (
        <p className="logout-error" role="alert">
          {logoutError}
        </p>
      )}
    </header>
  );
}
