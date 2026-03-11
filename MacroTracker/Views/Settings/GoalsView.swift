import SwiftUI
import SwiftData

struct GoalsView: View {
    @Environment(\.modelContext) private var modelContext
    @Query private var goals: [DailyGoal]

    @State private var bodyWeightText = ""
    @State private var proteinPerLbText = "1.0"
    @State private var showSavedToast = false

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
                    ), unit: "kcal", color: Color.highlight)

                    MacroGoalRow(label: "Protein", value: Binding(
                        get: { goal.protein },
                        set: { goal.protein = $0 }
                    ), unit: "g", color: Color.accent)

                    MacroGoalRow(label: "Carbs", value: Binding(
                        get: { goal.carbs },
                        set: { goal.carbs = $0 }
                    ), unit: "g", color: Color.highlight)

                    MacroGoalRow(label: "Fat", value: Binding(
                        get: { goal.fat },
                        set: { goal.fat = $0 }
                    ), unit: "g", color: .pink)
                }

                // Macro split visualization
                Section {
                    VStack(spacing: 8) {
                        Text("Macro Split")
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(.secondary)
                            .textCase(.uppercase)
                            .tracking(0.5)
                            .frame(maxWidth: .infinity, alignment: .leading)

                        let totalMacroCal = (goal.protein * 4) + (goal.carbs * 4) + (goal.fat * 9)
                        let proteinPct = totalMacroCal > 0 ? (goal.protein * 4) / totalMacroCal * 100 : 0
                        let carbsPct = totalMacroCal > 0 ? (goal.carbs * 4) / totalMacroCal * 100 : 0
                        let fatPct = totalMacroCal > 0 ? (goal.fat * 9) / totalMacroCal * 100 : 0

                        GeometryReader { geometry in
                            HStack(spacing: 2) {
                                RoundedRectangle(cornerRadius: 3)
                                    .fill(Color.accent)
                                    .frame(width: max(geometry.size.width * proteinPct / 100, 4))
                                RoundedRectangle(cornerRadius: 3)
                                    .fill(Color.highlight)
                                    .frame(width: max(geometry.size.width * carbsPct / 100, 4))
                                RoundedRectangle(cornerRadius: 3)
                                    .fill(Color.pink)
                                    .frame(width: max(geometry.size.width * fatPct / 100, 4))
                            }
                        }
                        .frame(height: 10)

                        HStack(spacing: 16) {
                            MacroSplitLabel(label: "Protein", pct: proteinPct, color: Color.accent)
                            MacroSplitLabel(label: "Carbs", pct: carbsPct, color: Color.highlight)
                            MacroSplitLabel(label: "Fat", pct: fatPct, color: .pink)
                        }

                        let macroCalories = (goal.protein * 4) + (goal.carbs * 4) + (goal.fat * 9)
                        if abs(macroCalories - goal.calories) > 50 {
                            HStack(spacing: 4) {
                                Image(systemName: "exclamationmark.triangle.fill")
                                    .font(.caption2)
                                    .foregroundStyle(.orange)
                                Text("Macros total \(Int(macroCalories)) cal vs \(Int(goal.calories)) cal goal")
                                    .font(.caption2)
                                    .foregroundStyle(.orange)
                            }
                            .padding(.top, 2)
                        }
                    }
                    .padding(.vertical, 4)
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
                                .foregroundStyle(Color.accent)
                            Spacer()
                            Button("Apply") {
                                goal.protein = calculated
                                saveGoals()
                            }
                            .font(.subheadline.bold())
                            .foregroundStyle(.white)
                            .padding(.horizontal, 16)
                            .padding(.vertical, 6)
                            .background(Color.accent)
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
            .onChange(of: goal.calories) { _, _ in saveGoals() }
            .onChange(of: goal.protein) { _, _ in saveGoals() }
            .onChange(of: goal.carbs) { _, _ in saveGoals() }
            .onChange(of: goal.fat) { _, _ in saveGoals() }
            .overlay(alignment: .bottom) {
                if showSavedToast {
                    HStack(spacing: 6) {
                        Image(systemName: "checkmark.circle.fill")
                            .foregroundStyle(.green)
                        Text("Goals saved")
                            .font(.subheadline.weight(.medium))
                            .foregroundStyle(.white)
                    }
                    .padding(.horizontal, 16)
                    .padding(.vertical, 10)
                    .background(.black.opacity(0.85))
                    .clipShape(RoundedRectangle(cornerRadius: 10))
                    .padding(.bottom, 8)
                    .transition(.move(edge: .bottom).combined(with: .opacity))
                }
            }
        }
    }

    private func saveGoals() {
        try? modelContext.save()
    }

    private func applyPreset(calories: Double, protein: Double, carbs: Double, fat: Double) {
        goal.calories = calories
        goal.protein = protein
        goal.carbs = carbs
        goal.fat = fat
        saveGoals()
        UIImpactFeedbackGenerator(style: .medium).impactOccurred()
        withAnimation { showSavedToast = true }
        Task { @MainActor in
            try? await Task.sleep(for: .seconds(1.5))
            withAnimation { showSavedToast = false }
        }
    }
}

private struct MacroSplitLabel: View {
    let label: String
    let pct: Double
    let color: Color

    var body: some View {
        HStack(spacing: 4) {
            Circle()
                .fill(color)
                .frame(width: 6, height: 6)
            Text("\(label) \(Int(pct))%")
                .font(.caption2)
                .foregroundStyle(.secondary)
        }
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
                    .foregroundStyle(Color.accent)
                Text(title)
                    .font(.subheadline.bold())
                Text(subtitle)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 10)
            .background(Color.accent.opacity(0.08))
            .clipShape(RoundedRectangle(cornerRadius: 10))
        }
        .buttonStyle(.plain)
    }
}
