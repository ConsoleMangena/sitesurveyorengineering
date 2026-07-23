import { useEffect, useState } from "react";

export type ThemeMode = "light" | "dark";

const THEME_STORAGE_KEY = "sitesurveyor:theme";

function isThemeMode(value: string | null): value is ThemeMode {
  return value === "light" || value === "dark";
}

export function getStoredThemeMode(): ThemeMode | null {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    return isThemeMode(stored) ? stored : null;
  } catch {
    return null;
  }
}

export function getPreferredThemeMode(): ThemeMode {
  const stored = getStoredThemeMode();
  if (stored) return stored;

  if (
    typeof window !== "undefined" &&
    window.matchMedia &&
    window.matchMedia("(prefers-color-scheme: dark)").matches
  ) {
    return "dark";
  }
  return "light";
}

export function applyThemeMode(mode: ThemeMode) {
  document.documentElement.setAttribute("data-theme", mode);
  document.documentElement.style.colorScheme = mode;
}

export function initializeThemeMode() {
  if (typeof document === "undefined") return;
  applyThemeMode(getPreferredThemeMode());
}

export function setThemeMode(mode: ThemeMode) {
  localStorage.setItem(THEME_STORAGE_KEY, mode);
  applyThemeMode(mode);
}

export function useThemeMode() {
  const [themeMode, setThemeModeState] = useState<ThemeMode>(() =>
    getPreferredThemeMode(),
  );

  useEffect(() => {
    applyThemeMode(themeMode);
  }, [themeMode]);

  const updateThemeMode = (nextMode: ThemeMode) => {
    setThemeMode(nextMode);
    setThemeModeState(nextMode);
  };

  return {
    themeMode,
    setThemeMode: updateThemeMode,
    isDarkMode: themeMode === "dark",
  };
}
