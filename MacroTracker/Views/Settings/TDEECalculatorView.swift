import SwiftUI

struct TDEECalculatorView: View {
    @Environment(\.dismiss) private var dismiss
    @State private var vm = TDEECalculatorViewModel()
    @State private var step: TDEECalculatorViewModel.CalculatorStep = .profile

    let onApply: (TDEECalculatorViewModel.MacroResult) -> Void

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                stepIndicator
                    .padding(.top, 8)
                    .padding(.bottom, 4)

                switch step {
                case .profile: profileStep
                case .activity: activityStep
                case .goal: goalStep
                case .results: resultsStep
                }
            }
            .background(Color.surfaceBackground)
            .navigationTitle(step.title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    if step == .profile {
                        Button("Cancel") { dismiss() }
                    } else {
                        Button {
                            withAnimation(.easeInOut(duration: 0.25)) {
                                step = step.previous
                            }
                        } label: {
                            HStack(spacing: 4) {
                                Image(systemName: "chevron.left")
                                    .font(.caption.weight(.semibold))
                                Text("Back")
                            }
                        }
                    }
                }
                ToolbarItem(placement: .confirmationAction) {
                    if step == .results {
                        Button("Apply") {
                            onApply(vm.suggestedMacros)
                            dismiss()
                        }
                        .bold()
                    } else {
                        Button("Next") {
                            withAnimation(.easeInOut(duration: 0.25)) {
                                step = step.next
                            }
                            UIImpactFeedbackGenerator(style: .light).impactOccurred()
                        }
                        .bold()
                        .disabled(step == .profile && !vm.isProfileValid)
                    }
                }
            }
        }
    }

    // MARK: - Step Indicator

    private var stepIndicator: some View {
        HStack(spacing: 8) {
            ForEach(TDEECalculatorViewModel.CalculatorStep.allCases, id: \.rawValue) { s in
                Circle()
                    .fill(s.rawValue <= step.rawValue ? Color.accent : Color.primary.opacity(0.15))
                    .frame(width: 8, height: 8)
                    .scaleEffect(s == step ? 1.2 : 1.0)
                    .animation(.easeInOut(duration: 0.2), value: step)
            }
        }
    }

    // MARK: - Step 1: Profile

    private var profileStep: some View {
        Form {
            Section {
                Picker("Units", selection: $vm.useMetric) {
                    Text("Imperial").tag(false)
                    Text("Metric").tag(true)
                }
                .pickerStyle(.segmented)
                .listRowBackground(Color.clear)
                .listRowInsets(EdgeInsets(top: 8, leading: 16, bottom: 8, trailing: 16))
            }

            Section("Personal") {
                Picker("Sex", selection: $vm.sex) {
                    ForEach(TDEECalculatorViewModel.BiologicalSex.allCases) { s in
                        Text(s.rawValue).tag(s)
                    }
                }
                .pickerStyle(.segmented)

                HStack {
                    Text("Age")
                        .font(.subheadline.weight(.medium))
                    Spacer()
                    TextField("25", text: $vm.ageText)
                        .keyboardType(.numberPad)
                        .multilineTextAlignment(.trailing)
                        .frame(width: 60)
                    Text("years")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .frame(width: 40, alignment: .leading)
                }
            }

            Section("Body") {
                HStack {
                    Text("Weight")
                        .font(.subheadline.weight(.medium))
                    Spacer()
                    TextField("0", text: $vm.weightText)
                        .keyboardType(.decimalPad)
                        .multilineTextAlignment(.trailing)
                        .frame(width: 80)
                    Text(vm.useMetric ? "kg" : "lbs")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .frame(width: 30, alignment: .leading)
                }

                if vm.useMetric {
                    HStack {
                        Text("Height")
                            .font(.subheadline.weight(.medium))
                        Spacer()
                        TextField("0", text: $vm.heightCmText)
                            .keyboardType(.decimalPad)
                            .multilineTextAlignment(.trailing)
                            .frame(width: 80)
                        Text("cm")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .frame(width: 30, alignment: .leading)
                    }
                } else {
                    HStack {
                        Text("Height")
                            .font(.subheadline.weight(.medium))
                        Spacer()
                        TextField("5", text: $vm.heightFeetText)
                            .keyboardType(.numberPad)
                            .multilineTextAlignment(.trailing)
                            .frame(width: 40)
                        Text("ft")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                        TextField("10", text: $vm.heightInchesText)
                            .keyboardType(.numberPad)
                            .multilineTextAlignment(.trailing)
                            .frame(width: 40)
                        Text("in")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
            }

            Section {
                Toggle(isOn: $vm.useBodyFat) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Body Fat %")
                            .font(.subheadline.weight(.medium))
                        Text("Enables lean mass–based protein targeting")
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                    }
                }
                .tint(Color.accent)

                if vm.useBodyFat {
                    VStack(spacing: 8) {
                        HStack {
                            Text("\(Int(vm.bodyFatPercentage))%")
                                .font(.system(.title3, design: .rounded).bold())
                                .foregroundStyle(Color.accent)
                                .frame(width: 50)
                            Slider(value: $vm.bodyFatPercentage, in: 5...50, step: 1)
                                .tint(Color.accent)
                        }
                        HStack {
                            Text("Lean mass: \(Int(vm.leanBodyMassLbs)) lbs")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                            Spacer()
                        }
                    }
                }
            }
        }
    }

    // MARK: - Step 2: Activity Level

    private var activityStep: some View {
        Form {
            Section {
                ForEach(TDEECalculatorViewModel.ActivityLevel.allCases) { level in
                    Button {
                        vm.activityLevel = level
                        UIImpactFeedbackGenerator(style: .light).impactOccurred()
                    } label: {
                        HStack(spacing: 12) {
                            Image(systemName: level.icon)
                                .font(.body)
                                .foregroundStyle(vm.activityLevel == level ? Color.accent : .secondary)
                                .frame(width: 32)

                            VStack(alignment: .leading, spacing: 2) {
                                Text(level.rawValue)
                                    .font(.subheadline.weight(.semibold))
                                    .foregroundStyle(vm.activityLevel == level ? Color.accent : .primary)
                                Text(level.subtitle)
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }

                            Spacer()

                            Text("×\(String(format: "%.2f", level.multiplier))")
                                .font(.caption.monospaced())
                                .foregroundStyle(.secondary)

                            if vm.activityLevel == level {
                                Image(systemName: "checkmark.circle.fill")
                                    .foregroundStyle(Color.accent)
                            }
                        }
                    }
                    .tint(.primary)
                }
            }

            Section {
                VStack(spacing: 12) {
                    TDEESummaryRow(label: "BMR", value: vm.bmr, unit: "cal/day", caption: "Calories at complete rest")
                    Divider()
                    TDEESummaryRow(label: "TDEE", value: vm.tdee, unit: "cal/day", caption: "Total daily expenditure", highlighted: true)
                }
                .padding(.vertical, 4)
            }
        }
    }

    // MARK: - Step 3: Goal

    private var goalStep: some View {
        Form {
            Section("What's your goal?") {
                HStack(spacing: 12) {
                    ForEach(TDEECalculatorViewModel.GoalType.allCases) { goal in
                        GoalTypeButton(
                            goal: goal,
                            isSelected: vm.goalType == goal
                        ) {
                            vm.goalType = goal
                            UIImpactFeedbackGenerator(style: .medium).impactOccurred()
                        }
                    }
                }
                .listRowBackground(Color.clear)
                .listRowInsets(EdgeInsets(top: 8, leading: 0, bottom: 8, trailing: 0))
            }

            Section("Calorie Adjustment") {
                VStack(spacing: 12) {
                    HStack(spacing: 8) {
                        ForEach(TDEECalculatorViewModel.adjustmentOptions, id: \.self) { adj in
                            Button {
                                vm.calorieAdjustment = adj
                                UIImpactFeedbackGenerator(style: .light).impactOccurred()
                            } label: {
                                Text(adj >= 0 ? "+\(adj)" : "\(adj)")
                                    .font(.caption.weight(.semibold))
                                    .frame(maxWidth: .infinity)
                                    .padding(.vertical, 8)
                                    .background(
                                        vm.calorieAdjustment == adj
                                        ? Color.accent
                                        : Color.accent.opacity(0.08)
                                    )
                                    .foregroundStyle(
                                        vm.calorieAdjustment == adj ? .white : Color.accent
                                    )
                                    .clipShape(RoundedRectangle(cornerRadius: 8))
                            }
                            .buttonStyle(.plain)
                        }
                    }

                    Text(adjustmentDescription)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
            }

            Section {
                VStack(spacing: 12) {
                    TDEESummaryRow(label: "TDEE", value: vm.tdee, unit: "cal/day", caption: nil)
                    Divider()
                    HStack {
                        Text("Adjustment")
                            .font(.subheadline.weight(.medium))
                        Spacer()
                        Text(vm.calorieAdjustment >= 0 ? "+\(vm.calorieAdjustment)" : "\(vm.calorieAdjustment)")
                            .font(.subheadline.weight(.semibold))
                            .foregroundStyle(vm.calorieAdjustment < 0 ? .orange : vm.calorieAdjustment > 0 ? .green : .secondary)
                    }
                    Divider()
                    TDEESummaryRow(label: "Target", value: vm.targetCalories, unit: "cal/day", caption: nil, highlighted: true)
                }
                .padding(.vertical, 4)
            }

            if vm.lowCalorieWarning {
                Section {
                    HStack(spacing: 8) {
                        Image(systemName: "exclamationmark.triangle.fill")
                            .foregroundStyle(.orange)
                        Text("This calorie level is very low. Consult a healthcare professional before proceeding.")
                            .font(.caption)
                            .foregroundStyle(.orange)
                    }
                }
            }
        }
    }

    private var adjustmentDescription: String {
        if vm.calorieAdjustment < 0 {
            return "A \(abs(vm.calorieAdjustment)) cal deficit for ~\(String(format: "%.1f", Double(abs(vm.calorieAdjustment)) / 500.0)) lb/week loss."
        } else if vm.calorieAdjustment > 0 {
            return "A \(vm.calorieAdjustment) cal surplus for lean muscle gain."
        } else {
            return "No adjustment — eat at maintenance."
        }
    }

    // MARK: - Step 4: Results

    private var resultsStep: some View {
        let macros = vm.suggestedMacros

        return ScrollView {
            VStack(spacing: 20) {
                // Big calorie display
                VStack(spacing: 4) {
                    Text("\(Int(macros.calories))")
                        .font(.system(size: 48, weight: .bold, design: .rounded))
                        .foregroundStyle(Color.highlight)
                    Text("calories / day")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .textCase(.uppercase)
                        .tracking(0.5)
                }
                .padding(.top, 8)

                // Macro cards
                HStack(spacing: 12) {
                    MacroResultCard(
                        label: "Protein",
                        grams: macros.protein,
                        percent: macros.proteinPercent,
                        color: Color.accent
                    )
                    MacroResultCard(
                        label: "Carbs",
                        grams: macros.carbs,
                        percent: macros.carbsPercent,
                        color: Color.highlight
                    )
                    MacroResultCard(
                        label: "Fat",
                        grams: macros.fat,
                        percent: macros.fatPercent,
                        color: .pink
                    )
                }
                .padding(.horizontal)

                // Macro split bar
                VStack(spacing: 8) {
                    GeometryReader { geometry in
                        HStack(spacing: 2) {
                            RoundedRectangle(cornerRadius: 3)
                                .fill(Color.accent)
                                .frame(width: max(geometry.size.width * macros.proteinPercent / 100, 4))
                            RoundedRectangle(cornerRadius: 3)
                                .fill(Color.highlight)
                                .frame(width: max(geometry.size.width * macros.carbsPercent / 100, 4))
                            RoundedRectangle(cornerRadius: 3)
                                .fill(Color.pink)
                                .frame(width: max(geometry.size.width * macros.fatPercent / 100, 4))
                        }
                    }
                    .frame(height: 12)

                    HStack(spacing: 16) {
                        SplitLabel(label: "P", pct: macros.proteinPercent, color: Color.accent)
                        SplitLabel(label: "C", pct: macros.carbsPercent, color: Color.highlight)
                        SplitLabel(label: "F", pct: macros.fatPercent, color: .pink)
                    }
                }
                .padding(.horizontal)

                // Rationale
                VStack(alignment: .leading, spacing: 8) {
                    Text("Why this split?")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(.secondary)
                        .textCase(.uppercase)
                        .tracking(0.5)

                    Text(vm.goalType.rationale)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .padding()
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(Color.cardBackground)
                .clipShape(RoundedRectangle(cornerRadius: 12))
                .padding(.horizontal)

                // Warnings
                if vm.carbsWarning {
                    WarningBanner(
                        text: "Protein and fat targets exceed your calorie budget. Consider increasing calories or reducing protein/fat."
                    )
                    .padding(.horizontal)
                }

                if vm.lowCalorieWarning {
                    WarningBanner(
                        text: "This calorie level is very low. Consult a healthcare professional."
                    )
                    .padding(.horizontal)
                }

                // Calculation summary
                VStack(spacing: 8) {
                    CalculationRow(label: "BMR", value: "\(Int(vm.bmr)) cal")
                    CalculationRow(label: "Activity (×\(String(format: "%.2f", vm.activityLevel.multiplier)))", value: "\(Int(vm.tdee)) cal")
                    CalculationRow(label: "Adjustment", value: "\(vm.calorieAdjustment >= 0 ? "+" : "")\(vm.calorieAdjustment) cal")
                    Divider()
                    CalculationRow(label: "Target", value: "\(Int(vm.targetCalories)) cal", bold: true)
                }
                .padding()
                .background(Color.cardBackground)
                .clipShape(RoundedRectangle(cornerRadius: 12))
                .padding(.horizontal)

                // Apply button
                Button {
                    onApply(macros)
                    UIImpactFeedbackGenerator(style: .medium).impactOccurred()
                    dismiss()
                } label: {
                    Text("Apply to Goals")
                        .font(.headline)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 14)
                        .background(Color.accent)
                        .foregroundStyle(.white)
                        .clipShape(RoundedRectangle(cornerRadius: 14))
                }
                .padding(.horizontal)
                .padding(.bottom, 24)
            }
        }
    }
}

// MARK: - Supporting Views

private struct TDEESummaryRow: View {
    let label: String
    let value: Double
    let unit: String
    let caption: String?
    var highlighted: Bool = false

    var body: some View {
        HStack {
            VStack(alignment: .leading, spacing: 2) {
                Text(label)
                    .font(.subheadline.weight(.medium))
                if let caption {
                    Text(caption)
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
            }
            Spacer()
            VStack(alignment: .trailing) {
                Text("\(Int(value))")
                    .font(.system(.title3, design: .rounded).bold())
                    .foregroundStyle(highlighted ? Color.accent : .primary)
                Text(unit)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
        }
    }
}

private struct GoalTypeButton: View {
    let goal: TDEECalculatorViewModel.GoalType
    let isSelected: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            VStack(spacing: 6) {
                Image(systemName: goal.icon)
                    .font(.title3)
                    .foregroundStyle(isSelected ? .white : Color.accent)

                Text(goal.rawValue)
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(isSelected ? .white : .primary)
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 14)
            .background(isSelected ? Color.accent : Color.accent.opacity(0.08))
            .clipShape(RoundedRectangle(cornerRadius: 12))
            .overlay(
                RoundedRectangle(cornerRadius: 12)
                    .stroke(isSelected ? Color.accent : Color.clear, lineWidth: 2)
            )
        }
        .buttonStyle(.plain)
    }
}

private struct MacroResultCard: View {
    let label: String
    let grams: Double
    let percent: Double
    let color: Color

    var body: some View {
        VStack(spacing: 6) {
            Text("\(Int(grams))g")
                .font(.system(.title2, design: .rounded).bold())
                .foregroundStyle(color)

            Text("\(Int(percent))%")
                .font(.caption.weight(.semibold))
                .foregroundStyle(.secondary)

            Text(label)
                .font(.caption2)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 14)
        .background(Color.cardBackground)
        .clipShape(RoundedRectangle(cornerRadius: 12))
        .overlay(
            RoundedRectangle(cornerRadius: 12)
                .stroke(color.opacity(0.2), lineWidth: 1)
        )
    }
}

private struct SplitLabel: View {
    let label: String
    let pct: Double
    let color: Color

    var body: some View {
        HStack(spacing: 4) {
            Circle()
                .fill(color)
                .frame(width: 6, height: 6)
            Text("\(label) \(Int(pct))%")
                .font(.caption2.weight(.medium))
                .foregroundStyle(.secondary)
        }
    }
}

private struct WarningBanner: View {
    let text: String

    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: "exclamationmark.triangle.fill")
                .foregroundStyle(.orange)
            Text(text)
                .font(.caption)
                .foregroundStyle(.orange)
        }
        .padding()
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.orange.opacity(0.08))
        .clipShape(RoundedRectangle(cornerRadius: 10))
    }
}

private struct CalculationRow: View {
    let label: String
    let value: String
    var bold: Bool = false

    var body: some View {
        HStack {
            Text(label)
                .font(bold ? .subheadline.weight(.semibold) : .caption)
                .foregroundStyle(bold ? .primary : .secondary)
            Spacer()
            Text(value)
                .font(bold ? .subheadline.weight(.bold) : .caption.weight(.medium))
                .foregroundStyle(bold ? Color.accent : .primary)
        }
    }
}
