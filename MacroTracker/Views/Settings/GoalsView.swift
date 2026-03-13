import SwiftUI
import SwiftData

struct GoalsView: View {
    @Environment(\.modelContext) private var modelContext
    @Query private var goals: [DailyGoal]

    @State private var bodyWeightText = ""
    @State private var proteinPerLbText = "1.0"
    @State private var showSavedToast = false
    @State private var showTDEECalculator = false
    @State private var selectedDay: Int = 0 // 0 = default, 1-7 = weekday

    private static let dayLabels: [(id: Int, short: String, full: String)] = [
        (0, "Default", "Default"),
        (1, "S", "Sunday"),
        (2, "M", "Monday"),
        (3, "T", "Tuesday"),
        (4, "W", "Wednesday"),
        (5, "T", "Thursday"),
        (6, "F", "Friday"),
        (7, "S", "Saturday")
    ]

    /// Returns the goal for the currently selected day, creating default if needed.
    private var goal: DailyGoal {
        if let existing = goals.first(where: { $0.dayOfWeek == selectedDay }) {
            return existing
        }
        if selectedDay == 0 {
            let newGoal = DailyGoal()
            modelContext.insert(newGoal)
            try? modelContext.save()
            return newGoal
        }
        // For specific days, return default goal (but don't create an override yet)
        return goals.first(where: { $0.dayOfWeek == 0 }) ?? DailyGoal()
    }

    /// Whether a specific day override exists.
    private var hasOverride: Bool {
        selectedDay != 0 && goals.contains(where: { $0.dayOfWeek == selectedDay })
    }

    /// Whether we're viewing a specific day that uses the default.
    private var usesDefault: Bool {
        selectedDay != 0 && !hasOverride
    }

    var body: some View {
        NavigationStack {
            Form {
                // Day-of-week selector
                Section {
                    daySelector
                } header: {
                    Text("Schedule")
                } footer: {
                    if selectedDay == 0 {
                        Text("Default goals apply to all days without a specific override.")
                    } else if usesDefault {
                        Text("Using default goals for \(Self.dayLabels[selectedDay].full). Tap \"Customize\" to set different targets.")
                    } else {
                        Text("Custom goals for \(Self.dayLabels[selectedDay].full).")
                    }
                }

                if usesDefault {
                    // Show prompt to create day-specific override
                    Section {
                        Button {
                            createOverride()
                        } label: {
                            HStack {
                                Image(systemName: "plus.circle.fill")
                                    .foregroundStyle(Color.accent)
                                Text("Customize \(Self.dayLabels[selectedDay].full)")
                                    .font(.subheadline.weight(.semibold))
                                    .foregroundStyle(Color.accent)
                            }
                        }
                    }
                } else {
                    // Macro target rows
                    Section("Daily Targets\(selectedDay != 0 ? " — \(Self.dayLabels[selectedDay].full)" : "")") {
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
                        macroSplitView
                    }

                    // Reset to default (only for day-specific overrides)
                    if hasOverride {
                        Section {
                            Button(role: .destructive) {
                                deleteOverride()
                            } label: {
                                HStack {
                                    Image(systemName: "arrow.uturn.backward.circle")
                                    Text("Reset to Default")
                                }
                            }
                        }
                    }

                    // TDEE Calculator
                    Section {
                        Button {
                            showTDEECalculator = true
                        } label: {
                            HStack(spacing: 12) {
                                Image(systemName: "function")
                                    .font(.body.weight(.semibold))
                                    .foregroundStyle(.white)
                                    .frame(width: 36, height: 36)
                                    .background(
                                        LinearGradient(
                                            colors: [Color.accent, Color.highlight],
                                            startPoint: .topLeading,
                                            endPoint: .bottomTrailing
                                        )
                                    )
                                    .clipShape(RoundedRectangle(cornerRadius: 8))

                                VStack(alignment: .leading, spacing: 2) {
                                    Text("TDEE Calculator")
                                        .font(.subheadline.weight(.semibold))
                                    Text("Calculate your ideal macros based on your body and goals")
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                }

                                Spacer()

                                Image(systemName: "chevron.right")
                                    .font(.caption.weight(.semibold))
                                    .foregroundStyle(.tertiary)
                            }
                        }
                        .tint(.primary)
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
                                    ensureGoalExists()
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
            }
            .scrollDismissesKeyboard(.interactively)
            .navigationTitle("Goals")
            .toolbar {
                ToolbarItemGroup(placement: .keyboard) {
                    Spacer()
                    Button("Done") {
                        UIApplication.shared.sendAction(
                            #selector(UIResponder.resignFirstResponder),
                            to: nil, from: nil, for: nil
                        )
                    }
                    .font(.subheadline.bold())
                }
            }
            .onChange(of: goal.calories) { _, _ in saveGoals() }
            .onChange(of: goal.protein) { _, _ in saveGoals() }
            .onChange(of: goal.carbs) { _, _ in saveGoals() }
            .onChange(of: goal.fat) { _, _ in saveGoals() }
            .sheet(isPresented: $showTDEECalculator) {
                TDEECalculatorView { result in
                    applyPreset(
                        calories: result.calories,
                        protein: result.protein,
                        carbs: result.carbs,
                        fat: result.fat
                    )
                }
            }
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

    // MARK: - Day Selector

    private var daySelector: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 6) {
                ForEach(Self.dayLabels, id: \.id) { day in
                    let isSelected = selectedDay == day.id
                    let hasDayOverride = day.id != 0 && goals.contains(where: { $0.dayOfWeek == day.id })

                    Button {
                        withAnimation(.spring(response: 0.3, dampingFraction: 0.75)) {
                            selectedDay = day.id
                        }
                        UIImpactFeedbackGenerator(style: .light).impactOccurred()
                    } label: {
                        VStack(spacing: 2) {
                            Text(day.short)
                                .font(day.id == 0 ? .caption.weight(.semibold) : .subheadline.weight(.semibold))
                            if hasDayOverride {
                                Circle()
                                    .fill(Color.accent)
                                    .frame(width: 4, height: 4)
                            }
                        }
                        .frame(width: day.id == 0 ? 64 : 36, height: 44)
                        .background(
                            RoundedRectangle(cornerRadius: 10)
                                .fill(isSelected ? Color.accent : Color.clear)
                        )
                        .foregroundStyle(isSelected ? .white : .primary)
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.vertical, 2)
        }
    }

    // MARK: - Macro Split View

    private var macroSplitView: some View {
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

    // MARK: - Actions

    private func saveGoals() {
        try? modelContext.save()
    }

    private func ensureGoalExists() {
        if selectedDay != 0 && !goals.contains(where: { $0.dayOfWeek == selectedDay }) {
            let defaultGoal = goals.first(where: { $0.dayOfWeek == 0 })
            let newGoal = DailyGoal(
                calories: defaultGoal?.calories ?? 2000,
                protein: defaultGoal?.protein ?? 150,
                carbs: defaultGoal?.carbs ?? 250,
                fat: defaultGoal?.fat ?? 65,
                dayOfWeek: selectedDay
            )
            modelContext.insert(newGoal)
            try? modelContext.save()
        }
    }

    private func createOverride() {
        ensureGoalExists()
        UIImpactFeedbackGenerator(style: .medium).impactOccurred()
        withAnimation { showSavedToast = true }
        Task { @MainActor in
            try? await Task.sleep(for: .seconds(1.5))
            withAnimation { showSavedToast = false }
        }
    }

    private func deleteOverride() {
        if let override = goals.first(where: { $0.dayOfWeek == selectedDay }) {
            modelContext.delete(override)
            try? modelContext.save()
            UIImpactFeedbackGenerator(style: .medium).impactOccurred()
        }
    }

    private func applyPreset(calories: Double, protein: Double, carbs: Double, fat: Double) {
        ensureGoalExists()
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

    @State private var text: String = ""

    var body: some View {
        HStack {
            Circle()
                .fill(color)
                .frame(width: 10, height: 10)
            Text(label)
                .font(.subheadline.weight(.medium))
            Spacer()
            TextField("0", text: $text)
                .keyboardType(.numberPad)
                .multilineTextAlignment(.trailing)
                .frame(width: 80)
                .onChange(of: text) { _, newValue in
                    if let intVal = Int(newValue) {
                        value = Double(intVal)
                    }
                }
            Text(unit)
                .foregroundStyle(.secondary)
                .frame(width: 35, alignment: .leading)
        }
        .onAppear {
            text = "\(Int(value))"
        }
        .onChange(of: value) { _, newValue in
            let newText = "\(Int(newValue))"
            if text != newText {
                text = newText
            }
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
