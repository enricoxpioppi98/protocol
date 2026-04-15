import SwiftUI

struct NutritionLabelView: View {
    let calories: Double
    let protein: Double
    let carbs: Double
    let fat: Double
    var fiber: Double = 0

    var body: some View {
        VStack(spacing: 14) {
            // Calories - big display
            VStack(spacing: 2) {
                Text("\(Int(calories))")
                    .font(.system(size: 48, weight: .bold, design: .rounded))
                    .foregroundStyle(Color.highlight)
                Text("calories")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .textCase(.uppercase)
                    .tracking(0.5)
            }

            Divider()
                .padding(.horizontal, 8)

            // Macros row
            HStack(spacing: 0) {
                MacroColumn(value: protein, label: "Protein", unit: "g", color: Color.accent)
                Divider().frame(height: 44)
                MacroColumn(value: carbs, label: "Carbs", unit: "g", color: Color.highlight)
                Divider().frame(height: 44)
                MacroColumn(value: fat, label: "Fat", unit: "g", color: .pink)
                Divider().frame(height: 44)
                MacroColumn(value: fiber, label: "Fiber", unit: "g", color: Color(red: 0.19, green: 0.82, blue: 0.35))
            }
        }
        .padding(.vertical, 18)
        .padding(.horizontal, 12)
        .background(Color.cardBackground)
        .clipShape(RoundedRectangle(cornerRadius: 16))
        .overlay(
            RoundedRectangle(cornerRadius: 16)
                .stroke(Color.primary.opacity(0.06), lineWidth: 1)
        )
    }
}

private struct MacroColumn: View {
    let value: Double
    let label: String
    let unit: String
    let color: Color

    var body: some View {
        VStack(spacing: 4) {
            Text(String(format: "%.1f%@", value, unit))
                .font(.system(.headline, design: .rounded))
                .foregroundStyle(color)
            Text(label)
                .font(.caption2)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity)
    }
}
