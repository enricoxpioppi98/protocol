import SwiftUI
import SwiftData

struct GoalsView: View {
    @Environment(\.modelContext) private var modelContext
    @Query private var goals: [DailyGoal]

    @State private var selectedDay: Int = 0
    @State private var showTDEECalculator = false
    @State private var showSavedToast = false

    // ALL display state — single source of truth for the UI
    @State private var calories: Double = 2000
    @State private var proteinGrams: Double = 150
    @State private var carbsRatio: Double = 0.5  // 0…1, fraction of remaining cals → carbs

    // Text fields
    @State private var caloriesText = "2000"
    @FocusState private var caloriesFocused: Bool

    // Protein calculator inputs (persisted in UserDefaults)
    @State private var bodyWeightText = ""
    @State private var proteinPerLbText = "1.0"

    private static let dayLabels: [(id: Int, short: String, full: String)] = [
        (0, "Default", "Default"),
        (1, "S", "Sunday"), (2, "M", "Monday"), (3, "T", "Tuesday"),
        (4, "W", "Wednesday"), (5, "T", "Thursday"), (6, "F", "Friday"), (7, "S", "Saturday"),
    ]

    // MARK: - Derived (all from @State, never from model)

    private var proteinCal: Double { proteinGrams * 4 }
    private var remainingCal: Double { max(calories - proteinCal, 0) }
    private var carbsGrams: Double { (remainingCal * carbsRatio) / 4 }
    private var fatGrams: Double { (remainingCal * (1 - carbsRatio)) / 9 }

    private var proteinPct: Double {
        guard calories > 0 else { return 0 }
        return proteinCal / calories * 100
    }
    private var carbsPct: Double {
        guard calories > 0 else { return 0 }
        return (carbsGrams * 4) / calories * 100
    }
    private var fatPct: Double {
        guard calories > 0 else { return 0 }
        return (fatGrams * 9) / calories * 100
    }

    // MARK: - Goal helpers

    private var hasOverride: Bool {
        selectedDay != 0 && goals.contains(where: { $0.dayOfWeek == selectedDay })
    }

    private var usesDefault: Bool {
        selectedDay != 0 && !hasOverride
    }

    /// Find or create the persisted goal for the selected day.
    private func persistedGoal() -> DailyGoal {
        if let existing = goals.first(where: { $0.dayOfWeek == selectedDay }) {
            return existing
        }
        let def = goals.first(where: { $0.dayOfWeek == 0 })
        let g = DailyGoal(
            calories: def?.calories ?? 2000,
            protein: def?.protein ?? 150,
            carbs: def?.carbs ?? 250,
            fat: def?.fat ?? 65,
            dayOfWeek: selectedDay
        )
        modelContext.insert(g)
        try? modelContext.save()
        return g
    }

    // MARK: - Body

    var body: some View {
        NavigationStack {
            Form {
                scheduleSection

                if usesDefault {
                    Section {
                        Button {
                            createOverride()
                        } label: {
                            Label(
                                "Customize \(Self.dayLabels[selectedDay].full)",
                                systemImage: "plus.circle.fill"
                            )
                            .font(.subheadline.weight(.semibold))
                            .foregroundStyle(Color.accent)
                        }
                    }
                } else {
                    caloriesSection
                    proteinSection
                    macroSplitSection

                    if hasOverride {
                        Section {
                            Button(role: .destructive) { deleteOverride() } label: {
                                Label(
                                    "Reset to Default",
                                    systemImage: "arrow.uturn.backward.circle")
                            }
                        }
                    }
                }
            }
            .scrollDismissesKeyboard(.interactively)
            .navigationTitle("Goals")
            .toolbar {
                ToolbarItemGroup(placement: .keyboard) {
                    Spacer()
                    Button("Done") { caloriesFocused = false }
                        .font(.subheadline.bold())
                }
            }
            .onAppear {
                bodyWeightText = UserDefaults.standard.string(forKey: "goals_bodyWeight") ?? ""
                proteinPerLbText =
                    UserDefaults.standard.string(forKey: "goals_proteinPerLb") ?? "1.0"
                loadStateFromModel()
            }
            .onChange(of: selectedDay) { _, _ in loadStateFromModel() }
            .sheet(isPresented: $showTDEECalculator) {
                TDEECalculatorView { result in
                    calories = result.calories
                    caloriesText = "\(Int(calories))"
                    saveToModel()
                    UIImpactFeedbackGenerator(style: .medium).impactOccurred()
                    showToast()
                }
            }
            .overlay(alignment: .bottom) {
                if showSavedToast { toastView }
            }
        }
    }

    // MARK: - Schedule

    private var scheduleSection: some View {
        Section {
            daySelector
        } header: {
            Text("Schedule")
        } footer: {
            if selectedDay == 0 {
                Text("Default goals apply to all days without a specific override.")
            } else if usesDefault {
                Text(
                    "Using default goals for \(Self.dayLabels[selectedDay].full). Tap \"Customize\" to set different targets."
                )
            } else {
                Text("Custom goals for \(Self.dayLabels[selectedDay].full).")
            }
        }
    }

    // MARK: - Calories

    private var caloriesSection: some View {
        Section {
            HStack {
                Image(systemName: "flame.fill")
                    .foregroundStyle(Color.highlight)
                    .frame(width: 24)
                Text("Total Calories")
                    .font(.subheadline.weight(.medium))
                Spacer()
                TextField("2000", text: $caloriesText)
                    .keyboardType(.numberPad)
                    .multilineTextAlignment(.trailing)
                    .font(.system(.title3, design: .rounded).bold())
                    .foregroundStyle(Color.highlight)
                    .frame(width: 100)
                    .focused($caloriesFocused)
                    .onChange(of: caloriesText) { _, newValue in
                        guard caloriesFocused, let cal = Double(newValue), cal > 0 else { return }
                        calories = cal
                        saveToModel()
                    }
                Text("kcal")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .frame(width: 30, alignment: .leading)
            }

            Button { showTDEECalculator = true } label: {
                HStack(spacing: 12) {
                    Image(systemName: "function")
                        .font(.body.weight(.semibold))
                        .foregroundStyle(.white)
                        .frame(width: 32, height: 32)
                        .background(
                            LinearGradient(
                                colors: [Color.accent, Color.highlight],
                                startPoint: .topLeading, endPoint: .bottomTrailing)
                        )
                        .clipShape(RoundedRectangle(cornerRadius: 7))
                    VStack(alignment: .leading, spacing: 2) {
                        Text("TDEE Calculator").font(.subheadline.weight(.semibold))
                        Text("Calculate based on your body and activity")
                            .font(.caption).foregroundStyle(.secondary)
                    }
                    Spacer()
                    Image(systemName: "chevron.right")
                        .font(.caption.weight(.semibold)).foregroundStyle(.tertiary)
                }
            }
            .tint(.primary)
        } header: {
            Text(
                "Calories\(selectedDay != 0 ? " — \(Self.dayLabels[selectedDay].full)" : "")"
            )
        }
    }

    // MARK: - Protein

    private var proteinSection: some View {
        Section("Protein") {
            HStack {
                Text("Body Weight").font(.subheadline.weight(.medium))
                Spacer()
                TextField("175", text: $bodyWeightText)
                    .keyboardType(.decimalPad)
                    .multilineTextAlignment(.trailing)
                    .frame(width: 80)
                    .onChange(of: bodyWeightText) { _, val in
                        UserDefaults.standard.set(val, forKey: "goals_bodyWeight")
                    }
                Text("lb").foregroundStyle(.secondary).frame(width: 35, alignment: .leading)
            }

            HStack {
                Text("Protein per lb").font(.subheadline.weight(.medium))
                Spacer()
                TextField("1.0", text: $proteinPerLbText)
                    .keyboardType(.decimalPad)
                    .multilineTextAlignment(.trailing)
                    .frame(width: 80)
                    .onChange(of: proteinPerLbText) { _, val in
                        UserDefaults.standard.set(val, forKey: "goals_proteinPerLb")
                    }
                Text("g/lb").foregroundStyle(.secondary).frame(width: 35, alignment: .leading)
            }

            if let bw = Double(bodyWeightText), let ppl = Double(proteinPerLbText), bw > 0, ppl > 0
            {
                let calculated = bw * ppl
                HStack {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("= \(Int(calculated))g protein")
                            .font(.subheadline.weight(.semibold))
                            .foregroundStyle(Color.accent)
                        if calories > 0 {
                            let pct = (calculated * 4) / calories * 100
                            Text("That's \(Int(pct))% of \(Int(calories)) cal")
                                .font(.caption2).foregroundStyle(.secondary)
                        }
                    }
                    Spacer()
                    Button {
                        proteinGrams = calculated
                        saveToModel()
                        UIImpactFeedbackGenerator(style: .medium).impactOccurred()
                        showToast()
                    } label: {
                        Text("Apply")
                            .font(.subheadline.bold())
                            .foregroundStyle(.white)
                            .padding(.horizontal, 16)
                            .padding(.vertical, 6)
                            .background(Color.accent)
                            .clipShape(Capsule())
                    }
                }
            }

            HStack {
                Text("Current protein")
                    .font(.subheadline.weight(.medium)).foregroundStyle(.secondary)
                Spacer()
                Text("\(Int(proteinGrams))g")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(Color.accent)
            }
        }
    }

    // MARK: - Macro Split

    private var macroSplitSection: some View {
        Section("Macro Split") {
            GeometryReader { geo in
                let w = geo.size.width
                HStack(spacing: 2) {
                    RoundedRectangle(cornerRadius: 3).fill(Color.accent)
                        .frame(width: max(w * proteinPct / 100, 4))
                    RoundedRectangle(cornerRadius: 3).fill(Color.highlight)
                        .frame(width: max(w * carbsPct / 100, 4))
                    RoundedRectangle(cornerRadius: 3).fill(Color.fatColor)
                        .frame(width: max(w * fatPct / 100, 4))
                }
            }
            .frame(height: 12)
            .padding(.vertical, 4)

            macroRow(
                color: .accent, name: "Protein",
                pct: proteinPct, grams: proteinGrams, calPerGram: 4)

            VStack(spacing: 6) {
                Slider(value: $carbsRatio, in: 0...1, step: 0.01)
                    .tint(Color.highlight)
                    .onChange(of: carbsRatio) { _, _ in saveToModel() }
                HStack {
                    Text("More Carbs").font(.caption2).foregroundStyle(.secondary)
                    Spacer()
                    Text("More Fat").font(.caption2).foregroundStyle(.secondary)
                }
            }
            .padding(.vertical, 4)

            macroRow(
                color: .highlight, name: "Carbs",
                pct: carbsPct, grams: carbsGrams, calPerGram: 4)

            macroRow(
                color: .fatColor, name: "Fat",
                pct: fatPct, grams: fatGrams, calPerGram: 9)

            HStack {
                Text("Total").font(.subheadline.weight(.semibold))
                Spacer()
                let total = proteinPct + carbsPct + fatPct
                Text("\(Int(round(total)))%")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(abs(total - 100) < 2 ? .green : .orange)
            }
        }
    }

    private func macroRow(color: Color, name: String, pct: Double, grams: Double, calPerGram: Double)
        -> some View
    {
        HStack(spacing: 8) {
            Circle().fill(color).frame(width: 10, height: 10)
            Text(name).font(.subheadline.weight(.medium)).frame(width: 55, alignment: .leading)
            Text("\(Int(round(pct)))%")
                .font(.subheadline.weight(.semibold)).foregroundStyle(.secondary)
                .frame(width: 40, alignment: .trailing)
            Spacer()
            VStack(alignment: .trailing, spacing: 1) {
                Text("\(Int(round(grams)))g")
                    .font(.subheadline.weight(.semibold)).foregroundStyle(color)
                Text("\(Int(round(grams * calPerGram))) cal")
                    .font(.caption2).foregroundStyle(.secondary)
            }
        }
    }

    // MARK: - Day Selector

    private var daySelector: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 6) {
                ForEach(Self.dayLabels, id: \.id) { day in
                    let isSelected = selectedDay == day.id
                    let hasDot = day.id != 0 && goals.contains(where: { $0.dayOfWeek == day.id })
                    Button {
                        withAnimation(.spring(response: 0.3, dampingFraction: 0.75)) {
                            selectedDay = day.id
                        }
                        UIImpactFeedbackGenerator(style: .light).impactOccurred()
                    } label: {
                        VStack(spacing: 2) {
                            Text(day.short).font(
                                day.id == 0
                                    ? .caption.weight(.semibold) : .subheadline.weight(.semibold))
                            if hasDot {
                                Circle().fill(Color.accent).frame(width: 4, height: 4)
                            }
                        }
                        .frame(width: day.id == 0 ? 64 : 36, height: 44)
                        .background(
                            RoundedRectangle(cornerRadius: 10).fill(
                                isSelected ? Color.accent : .clear))
                        .foregroundStyle(isSelected ? .white : .primary)
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.vertical, 2)
        }
    }

    // MARK: - Toast

    private var toastView: some View {
        HStack(spacing: 6) {
            Image(systemName: "checkmark.circle.fill").foregroundStyle(.green)
            Text("Goals saved").font(.subheadline.weight(.medium)).foregroundStyle(.white)
        }
        .padding(.horizontal, 16).padding(.vertical, 10)
        .background(.black.opacity(0.85))
        .clipShape(RoundedRectangle(cornerRadius: 10))
        .padding(.bottom, 8)
        .transition(.move(edge: .bottom).combined(with: .opacity))
    }

    // MARK: - State ↔ Model

    /// Pull values from the persisted model into @State.
    private func loadStateFromModel() {
        let g: DailyGoal
        if let existing = goals.first(where: { $0.dayOfWeek == selectedDay }) {
            g = existing
        } else if let def = goals.first(where: { $0.dayOfWeek == 0 }) {
            g = def
        } else {
            g = DailyGoal()
        }

        calories = g.calories
        caloriesText = "\(Int(g.calories))"
        proteinGrams = g.protein

        let protCal = g.protein * 4
        let remaining = g.calories - protCal
        if remaining > 0 {
            carbsRatio = min(max((g.carbs * 4) / remaining, 0), 1)
        } else {
            carbsRatio = 0.5
        }
    }

    /// Push current @State values into the persisted model.
    private func saveToModel() {
        let g = persistedGoal()
        g.calories = calories
        g.protein = proteinGrams
        g.carbs = carbsGrams
        g.fat = fatGrams
        try? modelContext.save()
    }

    private func createOverride() {
        _ = persistedGoal()
        loadStateFromModel()
        UIImpactFeedbackGenerator(style: .medium).impactOccurred()
        showToast()
    }

    private func deleteOverride() {
        if let o = goals.first(where: { $0.dayOfWeek == selectedDay }) {
            modelContext.delete(o)
            try? modelContext.save()
            loadStateFromModel()
            UIImpactFeedbackGenerator(style: .medium).impactOccurred()
        }
    }

    private func showToast() {
        withAnimation { showSavedToast = true }
        Task { @MainActor in
            try? await Task.sleep(for: .seconds(1.5))
            withAnimation { showSavedToast = false }
        }
    }
}
