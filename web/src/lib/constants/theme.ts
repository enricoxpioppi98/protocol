// Ported from MacroTracker/Theme.swift
// Color values match the iOS app exactly

export const colors = {
  accent: 'rgb(59, 130, 245)',       // Electric Blue (0.23, 0.51, 0.96)
  accentEnd: 'rgb(66, 56, 201)',     // Gradient end (0.26, 0.22, 0.79)
  highlight: 'rgb(245, 158, 10)',    // Soft Amber (0.96, 0.62, 0.04)
  highlightEnd: 'rgb(235, 115, 13)', // Gradient end (0.92, 0.45, 0.05)
  fat: 'rgb(140, 92, 245)',          // Violet (0.55, 0.36, 0.96)
  card: 'rgb(28, 28, 30)',           // secondarySystemBackground (dark)
  surface: 'rgb(0, 0, 0)',           // systemGroupedBackground (dark)
  subtleBorder: 'rgba(255, 255, 255, 0.06)',
} as const;

export const macroColors = {
  calories: colors.highlight,
  protein: colors.accent,
  carbs: colors.highlight,
  fat: colors.fat,
} as const;
