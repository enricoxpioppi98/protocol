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
    let fiber: Double
    let fiberGoal: Double

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
                    .animation(.spring(response: 0.6, dampingFraction: 0.7), value: calories)

                VStack(spacing: 2) {
                    Text("\(Int(calories))")
                        .font(.system(size: 34, weight: .bold, design: .rounded))
                        .contentTransition(.numericText())
                    Text("/ \(Int(calorieGoal)) cal")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    let remaining = max(calorieGoal - calories, 0)
                    Text("\(Int(remaining)) left")
                        .font(.caption2.weight(.medium))
                        .foregroundStyle(remaining > 0 ? Color.highlight : .red)
                }
            }
            .frame(width: 160, height: 160)

            // Macro mini rings
            HStack(spacing: 24) {
                MiniRing(label: "P", value: protein, goal: proteinGoal, color: Color.accent)
                MiniRing(label: "C", value: carbs, goal: carbsGoal, color: Color.highlight)
                MiniRing(label: "F", value: fat, goal: fatGoal, color: Color.fatColor)
                MiniRing(label: "Fb", value: fiber, goal: fiberGoal, color: Color(red: 0.19, green: 0.82, blue: 0.35))
            }
        }
        .padding(.vertical, 4)
        .onChange(of: calories) { oldValue, newValue in
            if oldValue < calorieGoal && newValue >= calorieGoal {
                UINotificationFeedbackGenerator().notificationOccurred(.success)
            }
        }
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

    private var remaining: Double {
        max(goal - value, 0)
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
                    .animation(.spring(response: 0.6, dampingFraction: 0.7), value: value)

                Text("\(Int(value))")
                    .font(.caption2.bold())
                    .contentTransition(.numericText())
            }
            .frame(width: 50, height: 50)

            VStack(spacing: 1) {
                Text("\(label): \(Int(goal))g")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
                Text("\(Int(remaining))g left")
                    .font(.system(size: 9, weight: .medium))
                    .foregroundStyle(remaining > 0 ? color : .red)
            }
        }
    }
}
