import SwiftUI

extension Color {
    // Primary palette
    static let accent = Color(red: 0.08, green: 0.72, blue: 0.65)     // Teal
    static let highlight = Color(red: 0.96, green: 0.62, blue: 0.04)  // Amber

    // Adaptive colors for dark mode
    static let cardBackground = Color(.secondarySystemBackground)
    static let surfaceBackground = Color(.systemGroupedBackground)
    static let subtleBorder = Color.primary.opacity(0.06)
}
