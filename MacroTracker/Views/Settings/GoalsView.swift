import SwiftUI
import SwiftData

struct GoalsView: View {
    @Environment(\.modelContext) private var modelContext
    @Query private var goals: [DailyGoal]

    @State private var bodyWeightText = ""
    @State private var proteinPerLbText = "1.0"

    private var goal: DailyGoal {
        if let existing = goals.first {
            return existing
        }
        let newGoal = DailyGoal()
        modelContext.insert(newGoal)
        return newGoal
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("Daily Targets") {
                    MacroGoalRow(label: "Calories", value: Binding(
                        get: { goal.calories },
                        set: { goal.calories = $0 }
                    ), unit: "kcal", color: Color.hermesOrange)

                    MacroGoalRow(label: "Protein", value: Binding(
                        get: { goal.protein },
                        set: { goal.protein = $0 }
                    ), unit: "g", color: Color.royalBlue)

                    MacroGoalRow(label: "Carbs", value: Binding(
                        get: { goal.carbs },
                        set: { goal.carbs = $0 }
                    ), unit: "g", color: Color.hermesOrange)

                    MacroGoalRow(label: "Fat", value: Binding(
                        get: { goal.fat },
                        set: { goal.fat = $0 }
                    ), unit: "g", color: .pink)
                }

                Section("Protein Calculator") {
                    HStack {
                        Text("Body Weight")
                            .font(.subheadline.weight(.medium))
                        Spacer()
                        TextField("0", text: $bodyWeightText)
                            .keyboardType(.decimalPad)
                            .multilineTextAlignment(.trailing)
                            .frame(width: 80)
                        Text("lb")
                            .foregroundStyle(.secondary)
                            .frame(width: 35, alignment: .leading)
                    }

                    HStack {
                        Text("Protein per lb")
                            .font(.subheadline.weight(.medium))
                        Spacer()
                        TextField("0", text: $proteinPerLbText)
                            .keyboardType(.decimalPad)
                            .multilineTextAlignment(.trailing)
                            .frame(width: 80)
                        Text("g/lb")
                            .foregroundStyle(.secondary)
                            .frame(width: 35, alignment: .leading)
                    }

                    if let bw = Double(bodyWeightText), let ppl = Double(proteinPerLbText), bw > 0, ppl > 0 {
                        let calculated = bw * ppl
                        HStack {
                            Text("= \(Int(calculated))g protein")
                                .font(.subheadline.weight(.semibold))
                                .foregroundStyle(Color.royalBlue)
                            Spacer()
                            Button("Apply") {
                                goal.protein = calculated
                            }
                            .font(.subheadline.bold())
                            .foregroundStyle(.white)
                            .padding(.horizontal, 16)
                            .padding(.vertical, 6)
                            .background(Color.royalBlue)
                            .clipShape(Capsule())
                        }
                    }
                }

                Section {
                    VStack(alignment: .leading, spacing: 10) {
                        Text("Quick Presets")
                            .font(.headline)

                        HStack(spacing: 12) {
                            PresetButton(title: "Cut", subtitle: "1800 cal", icon: "arrow.down.circle") {
                                applyPreset(calories: 1800, protein: 180, carbs: 150, fat: 60)
                            }
                            PresetButton(title: "Maintain", subtitle: "2200 cal", icon: "equal.circle") {
                                applyPreset(calories: 2200, protein: 160, carbs: 250, fat: 70)
                            }
                            PresetButton(title: "Bulk", subtitle: "2800 cal", icon: "arrow.up.circle") {
                                applyPreset(calories: 2800, protein: 200, carbs: 350, fat: 80)
                            }
                        }
                    }
                    .padding(.vertical, 4)
                }
            }
            .navigationTitle("Goals")
        }
    }

    private func applyPreset(calories: Double, protein: Double, carbs: Double, fat: Double) {
        goal.calories = calories
        goal.protein = protein
        goal.carbs = carbs
        goal.fat = fat
    }
}

private struct MacroGoalRow: View {
    let label: String
    @Binding var value: Double
    let unit: String
    let color: Color

    var body: some View {
        HStack {
            Circle()
                .fill(color)
                .frame(width: 10, height: 10)
            Text(label)
                .font(.subheadline.weight(.medium))
            Spacer()
            TextField("0", value: $value, format: .number)
                .keyboardType(.numberPad)
                .multilineTextAlignment(.trailing)
                .frame(width: 80)
            Text(unit)
                .foregroundStyle(.secondary)
                .frame(width: 35, alignment: .leading)
        }
    }
}

private struct PresetButton: View {
    let title: String
    let subtitle: String
    let icon: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            VStack(spacing: 4) {
                Image(systemName: icon)
                    .font(.body)
                    .foregroundStyle(Color.royalBlue)
                Text(title)
                    .font(.subheadline.bold())
                Text(subtitle)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 10)
            .background(Color.royalBlue.opacity(0.08))
            .clipShape(RoundedRectangle(cornerRadius: 10))
        }
        .buttonStyle(.plain)
    }
}
