import SwiftUI

extension Color {
    // Primary palette
    static let accent = Color(red: 0.23, green: 0.51, blue: 0.96)     // Electric Blue
    static let highlight = Color(red: 0.96, green: 0.62, blue: 0.04)  // Soft Amber
    static let fatColor = Color(red: 0.55, green: 0.36, blue: 0.96)   // Violet
    static let fiberColor = Color(red: 0.19, green: 0.82, blue: 0.35)  // Green

    // Adaptive colors for dark mode
    static let cardBackground = Color(.secondarySystemBackground)
    static let surfaceBackground = Color(.systemGroupedBackground)
    static let subtleBorder = Color.primary.opacity(0.06)

    // Gradients
    static let accentGradient = LinearGradient(
        colors: [Color.accent, Color(red: 0.26, green: 0.22, blue: 0.79)],
        startPoint: .topLeading,
        endPoint: .bottomTrailing
    )
    static let calorieGradient = LinearGradient(
        colors: [Color.highlight, Color(red: 0.92, green: 0.45, blue: 0.05)],
        startPoint: .topLeading,
        endPoint: .bottomTrailing
    )
}

// MARK: - Button Styles

struct ScaleButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed ? 0.96 : 1.0)
            .opacity(configuration.isPressed ? 0.9 : 1.0)
            .animation(.spring(response: 0.25, dampingFraction: 0.7), value: configuration.isPressed)
    }
}

struct PrimaryButtonStyle: ButtonStyle {
    var color: Color = .accent

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.headline)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 14)
            .background(color)
            .foregroundStyle(.white)
            .clipShape(RoundedRectangle(cornerRadius: 14))
            .scaleEffect(configuration.isPressed ? 0.97 : 1.0)
            .opacity(configuration.isPressed ? 0.9 : 1.0)
            .animation(.spring(response: 0.25, dampingFraction: 0.7), value: configuration.isPressed)
    }
}

// MARK: - Card Modifier

struct CardStyle: ViewModifier {
    func body(content: Content) -> some View {
        content
            .padding()
            .background(Color.cardBackground)
            .clipShape(RoundedRectangle(cornerRadius: 16))
    }
}

extension View {
    func cardStyle() -> some View {
        modifier(CardStyle())
    }
}
