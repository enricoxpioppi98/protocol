import SwiftUI

struct MacroProgressBar: View {
    let label: String
    let current: Double
    let goal: Double
    let color: Color
    let unit: String

    private var progress: Double {
        guard goal > 0 else { return 0 }
        return min(current / goal, 1.0)
    }

    private var remaining: Double {
        max(goal - current, 0)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text(label)
                    .font(.subheadline.weight(.semibold))
                Spacer()
                Text("\(Int(current)) / \(Int(goal)) \(unit)")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            GeometryReader { geometry in
                ZStack(alignment: .leading) {
                    RoundedRectangle(cornerRadius: 5)
                        .fill(color.opacity(0.15))

                    RoundedRectangle(cornerRadius: 5)
                        .fill(current > goal ? .red : color)
                        .frame(width: geometry.size.width * progress)
                        .animation(.easeInOut(duration: 0.4), value: current)
                }
            }
            .frame(height: 10)

            Text("\(Int(remaining)) \(unit) remaining")
                .font(.caption2)
                .foregroundStyle(.secondary)
        }
    }
}
