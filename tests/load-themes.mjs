const themesPath = new URL('../client/themes.js', import.meta.url).pathname;
await import(themesPath);

export const {
  LIGHT_THEMES,
  customThemes,
  isLightTheme,
  themeColors,
  register
} = globalThis.ThemesSupport;
