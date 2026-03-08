import SwiftUI

struct MacroRingsView: View {
    let calories: Double
    let calorieGoal: Double
    let protein: Double
    let proteinGoal: Double
    let carbs: Double
    let carbsGoal: Double
    let fat: Double
    let fatGoal: Double

    var body: some View {
        VStack(spacing: 16) {
            // Calorie ring - main
            ZStack {
                Circle()
                    .stroke(Color.highlight.opacity(0.15), lineWidth: 14)

                Circle()
                    .trim(from: 0, to: ringProgress(calories, goal: calorieGoal))
                    .stroke(calories > calorieGoal ? .red : Color.highlight, style: StrokeStyle(lineWidth: 14, lineCap: .round))
                    .rotationEffect(.degrees(-90))
                    .animation(.easeInOut(duration: 0.5), value: calories)

                VStack(spacing: 2) {
                    Text("\(Int(calories))")
                        .font(.system(size: 34, weight: .bold, design: .rounded))
                    Text("/ \(Int(calorieGoal)) cal")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    let remaining = max(calorieGoal - calories, 0)
                    Text("\(Int(remaining)) left")
                        .font(.caption2.weight(.medium))
                        .foregroundStyle(Color.highlight)
                }
            }
            .frame(width: 160, height: 160)

            // Macro bars
            HStack(spacing: 24) {
                MiniRing(label: "P", value: protein, goal: proteinGoal, color: Color.accent)
                MiniRing(label: "C", value: carbs, goal: carbsGoal, color: Color.highlight)
                MiniRing(label: "F", value: fat, goal: fatGoal, color: .pink)
            }
        }
        .padding()
        .background(Color.cardBackground)
        .clipShape(RoundedRectangle(cornerRadius: 16))
    }

    private func ringProgress(_ value: Double, goal: Double) -> CGFloat {
        guard goal > 0 else { return 0 }
        return min(CGFloat(value / goal), 1.0)
    }
}

private struct MiniRing: View {
    let label: String
    let value: Double
    let goal: Double
    let color: Color

    private var progress: CGFloat {
        guard goal > 0 else { return 0 }
        return min(CGFloat(value / goal), 1.0)
    }

    var body: some View {
        VStack(spacing: 6) {
            ZStack {
                Circle()
                    .stroke(color.opacity(0.15), lineWidth: 6)

                Circle()
                    .trim(from: 0, to: progress)
                    .stroke(value > goal ? .red : color, style: StrokeStyle(lineWidth: 6, lineCap: .round))
                    .rotationEffect(.degrees(-90))
                    .animation(.easeInOut(duration: 0.5), value: value)

                Text("\(Int(value))")
                    .font(.caption2.bold())
            }
            .frame(width: 50, height: 50)

            Text("\(label): \(Int(goal))g")
                .font(.caption2)
                .foregroundStyle(.secondary)
                .lineLimit(1)
                .minimumScaleFactor(0.8)
        }
    }
}
