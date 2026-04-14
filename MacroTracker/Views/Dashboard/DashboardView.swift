import SwiftUI
import SwiftData
import MessageUI

struct DashboardView: View {
    @Environment(\.modelContext) private var modelContext
    @Query private var goals: [DailyGoal]
    @Query(sort: \DiaryEntry.date) private var allEntries: [DiaryEntry]
    @State private var selectedDate = Date()
    @State private var addingMealType: MealType?
    @State private var showMessageCompose = false
    @State private var showMessageUnavailable = false
    @State private var editingEntry: DiaryEntry?
    @State private var pendingDeletion: DiaryEntry?
    @State private var showUndoToast = false
    @State private var undoTask: Task<Void, Never>?
    @State private var showCopyConfirmation = false
    @State private var showGoalsOnboarding = false
    @State private var showMealTemplates = false
    @State private var quickAddToast: String?

    private var goal: DailyGoal {
        goals.goal(for: selectedDate)
    }

    private var todayEntries: [DiaryEntry] {
        allEntries.filter {
            Calendar.current.isDate($0.date, inSameDayAs: selectedDate)
            && $0.id != pendingDeletion?.id
        }
    }

    private var yesterdayEntries: [DiaryEntry] {
        let yesterday = Calendar.current.date(byAdding: .day, value: -1, to: selectedDate) ?? selectedDate
        return allEntries.filter { Calendar.current.isDate($0.date, inSameDayAs: yesterday) }
    }

    private var recentEntries: [DiaryEntry] {
        let calendar = Calendar.current
        let weekAgo = calendar.date(byAdding: .day, value: -7, to: selectedDate) ?? selectedDate
        return allEntries.filter {
            $0.date >= calendar.startOfDay(for: weekAgo)
            && !calendar.isDate($0.date, inSameDayAs: selectedDate)
        }
    }

    private var currentStreak: Int {
        let calendar = Calendar.current
        let today = calendar.startOfDay(for: Date())
        var streak = 0
        let todayHasEntries = allEntries.contains { calendar.isDate($0.date, inSameDayAs: today) }
        if todayHasEntries { streak = 1 }
        for offset in 1..<365 {
            guard let date = calendar.date(byAdding: .day, value: -offset, to: today) else { break }
            if allEntries.contains(where: { calendar.isDate($0.date, inSameDayAs: date) }) {
                streak += 1
            } else {
                break
            }
        }
        return streak
    }

    private func entries(for mealType: MealType) -> [DiaryEntry] {
        todayEntries.filter { $0.mealType == mealType }
    }

    private var totalCalories: Double { todayEntries.reduce(0) { $0 + $1.calories } }
    private var totalProtein: Double { todayEntries.reduce(0) { $0 + $1.protein } }
    private var totalCarbs: Double { todayEntries.reduce(0) { $0 + $1.carbs } }
    private var totalFat: Double { todayEntries.reduce(0) { $0 + $1.fat } }

    var body: some View {
        NavigationStack {
            Group {
                if todayEntries.isEmpty && goals.isEmpty {
                    emptyStateView
                } else {
                    mainScrollView
                }
            }
            .navigationTitle("MacroTracker")
            .toolbar {
                ToolbarItem(placement: .primaryAction) {
                    Menu {
                        Button {
                            if DailySummaryMessageView.canSendText {
                                showMessageCompose = true
                            } else {
                                showMessageUnavailable = true
                            }
                        } label: {
                            Label("Share Summary", systemImage: "message.fill")
                        }
                        Button {
                            UIPasteboard.general.string = formatClaudePrompt()
                            UINotificationFeedbackGenerator().notificationOccurred(.success)
                            withAnimation { quickAddToast = "Prompt copied to clipboard" }
                            Task { @MainActor in
                                try? await Task.sleep(for: .seconds(2))
                                withAnimation { quickAddToast = nil }
                            }
                        } label: {
                            Label("Ask Claude: Next Meal", systemImage: "sparkles")
                        }
                        Button {
                            showMealTemplates = true
                        } label: {
                            Label("Meal Templates", systemImage: "tray.2.fill")
                        }
                        Button {
                            showCopyConfirmation = true
                        } label: {
                            Label("Copy Yesterday", systemImage: "doc.on.doc")
                        }
                        .disabled(yesterdayEntries.isEmpty)
                    } label: {
                        Image(systemName: "ellipsis.circle")
                    }
                }
            }
            .sheet(item: $addingMealType) { mealType in
                FoodSearchView(mealType: mealType, date: selectedDate)
                    .presentationCornerRadius(24)
            }
            .sheet(item: $editingEntry) { entry in
                EditEntrySheet(entry: entry)
                    .presentationCornerRadius(24)
            }
            .sheet(isPresented: $showMessageCompose) {
                DailySummaryMessageView(messageBody: formatDailySummary())
                    .ignoresSafeArea()
            }
            .sheet(isPresented: $showMealTemplates) {
                MealTemplatesView(date: selectedDate) {
                    withAnimation { quickAddToast = "Template added" }
                    Task { @MainActor in
                        try? await Task.sleep(for: .seconds(2))
                        withAnimation { quickAddToast = nil }
                    }
                }
                .presentationCornerRadius(24)
            }
            .sheet(isPresented: $showGoalsOnboarding) {
                NavigationStack {
                    GoalsView()
                        .toolbar {
                            ToolbarItem(placement: .confirmationAction) {
                                Button("Done") { showGoalsOnboarding = false }
                                    .bold()
                            }
                        }
                }
                .presentationCornerRadius(24)
            }
            .alert("Messaging Unavailable", isPresented: $showMessageUnavailable) {
                Button("OK", role: .cancel) {}
            } message: {
                Text("iMessage is not available on this device.")
            }
            .alert("Copy Yesterday's Entries?", isPresented: $showCopyConfirmation) {
                Button("Copy") { copyFromYesterday() }
                Button("Cancel", role: .cancel) {}
            } message: {
                Text("This will add \(yesterdayEntries.count) entr\(yesterdayEntries.count == 1 ? "y" : "ies") to today.")
            }
        }
    }

    // MARK: - Empty State

    private var emptyStateView: some View {
        ScrollView {
            VStack(spacing: 24) {
                Spacer().frame(height: 60)

                Image(systemName: "fork.knife.circle.fill")
                    .font(.system(size: 64))
                    .foregroundStyle(Color.accent)

                Text("Welcome to MacroTracker")
                    .font(.title2.bold())

                Text("Start by setting your daily goals,\nthen log your first meal.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)

                VStack(spacing: 12) {
                    Button {
                        showGoalsOnboarding = true
                    } label: {
                        Label("Set Your Goals", systemImage: "target")
                    }
                    .buttonStyle(PrimaryButtonStyle())

                    Button {
                        addingMealType = .breakfast
                    } label: {
                        Label("Log Your First Meal", systemImage: "plus.circle.fill")
                            .font(.headline)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 14)
                            .background(Color.cardBackground)
                            .foregroundStyle(Color.accent)
                            .clipShape(RoundedRectangle(cornerRadius: 14))
                            .overlay(
                                RoundedRectangle(cornerRadius: 14)
                                    .stroke(Color.accent.opacity(0.3), lineWidth: 1)
                            )
                    }
                    .buttonStyle(ScaleButtonStyle())
                }
                .padding(.horizontal, 24)

                Spacer()
            }
        }
        .background(Color.surfaceBackground)
    }

    // MARK: - Main ScrollView

    private var mainScrollView: some View {
        ScrollView {
            VStack(spacing: 12) {
                // Streak
                if Calendar.current.isDateInToday(selectedDate) {
                    StreakBannerView(
                        streak: currentStreak,
                        todayCalories: totalCalories,
                        calorieGoal: goal.calories,
                        todayProtein: totalProtein,
                        proteinGoal: goal.protein
                    )
                    .padding(.horizontal, 16)
                }

                // Date strip
                DateStripView(selectedDate: $selectedDate) {
                    commitPendingDeletion()
                }
                .padding(.horizontal, 16)

                // Macro summary card (rings + compact bars + remaining)
                MacroSummaryCard(
                    calories: totalCalories,
                    calorieGoal: goal.calories,
                    protein: totalProtein,
                    proteinGoal: goal.protein,
                    carbs: totalCarbs,
                    carbsGoal: goal.carbs,
                    fat: totalFat,
                    fatGoal: goal.fat
                )
                .padding(.horizontal, 16)

                // Quick Add
                if Calendar.current.isDateInToday(selectedDate) && !recentEntries.isEmpty {
                    VStack(alignment: .leading, spacing: 8) {
                        Text("Quick Add")
                            .font(.subheadline.weight(.semibold))
                            .foregroundStyle(.secondary)
                            .padding(.horizontal, 20)

                        QuickAddView(
                            recentEntries: recentEntries,
                            date: selectedDate,
                            onQuickAdd: { entry in
                                quickAddEntry(from: entry)
                            }
                        )
                    }
                }

                // Meal sections
                ForEach(MealType.allCases) { mealType in
                    MealSectionView(
                        mealType: mealType,
                        entries: entries(for: mealType),
                        onAdd: { addingMealType = mealType },
                        onDelete: { entry in stageForDeletion(entry) },
                        onEdit: { entry in editingEntry = entry }
                    )
                    .padding(.horizontal, 16)
                }

                // Weekly trends
                VStack(alignment: .leading, spacing: 8) {
                    Text("Weekly Trends")
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(.secondary)
                        .padding(.horizontal, 20)

                    WeeklyTrendsView(entries: allEntries, goal: goal)
                        .padding(.horizontal, 16)
                }

                // Bottom padding for floating tab bar
                Spacer().frame(height: 80)
            }
            .padding(.top, 8)
        }
        .background(Color.surfaceBackground)
        .overlay(alignment: .bottom) {
            VStack(spacing: 8) {
                if let toast = quickAddToast {
                    quickAddToastView(toast)
                        .transition(.move(edge: .bottom).combined(with: .opacity))
                }
                if showUndoToast, let entry = pendingDeletion {
                    UndoToastView(message: "\(entry.name) deleted") {
                        undoTask?.cancel()
                        pendingDeletion = nil
                        withAnimation { showUndoToast = false }
                        UINotificationFeedbackGenerator().notificationOccurred(.success)
                    }
                }
            }
            .padding(.bottom, 90) // above tab bar
        }
    }

    private func quickAddToastView(_ message: String) -> some View {
        HStack(spacing: 8) {
            Image(systemName: "checkmark.circle.fill")
                .foregroundStyle(.green)
            Text(message)
                .font(.subheadline.weight(.medium))
                .foregroundStyle(.white)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
        .background(.black.opacity(0.85))
        .clipShape(RoundedRectangle(cornerRadius: 12))
        .padding(.horizontal, 16)
    }

    // MARK: - Deletion with Undo

    private func stageForDeletion(_ entry: DiaryEntry) {
        commitPendingDeletion()
        pendingDeletion = entry
        withAnimation { showUndoToast = true }
        UIImpactFeedbackGenerator(style: .light).impactOccurred()
        undoTask = Task { @MainActor in
            try? await Task.sleep(for: .seconds(3))
            guard !Task.isCancelled else { return }
            commitPendingDeletion()
        }
    }

    private func commitPendingDeletion() {
        undoTask?.cancel()
        if let entry = pendingDeletion {
            modelContext.delete(entry)
            try? modelContext.save()
            pendingDeletion = nil
            withAnimation { showUndoToast = false }
        }
    }

    // MARK: - Quick Add

    private func quickAddEntry(from source: DiaryEntry) {
        let entry = DiaryEntry(
            date: selectedDate,
            mealType: source.mealType,
            food: source.food,
            recipe: source.recipe,
            numberOfServings: 1
        )
        modelContext.insert(entry)
        try? modelContext.save()
        UINotificationFeedbackGenerator().notificationOccurred(.success)
        withAnimation { quickAddToast = "\(entry.name) added" }
        Task { @MainActor in
            try? await Task.sleep(for: .seconds(2))
            withAnimation { quickAddToast = nil }
        }
    }

    // MARK: - Copy from Yesterday

    private func copyFromYesterday() {
        for entry in yesterdayEntries {
            let newEntry = DiaryEntry(
                date: selectedDate,
                mealType: entry.mealType,
                food: entry.food,
                recipe: entry.recipe,
                numberOfServings: entry.numberOfServings
            )
            modelContext.insert(newEntry)
        }
        try? modelContext.save()
        UINotificationFeedbackGenerator().notificationOccurred(.success)
    }

    // MARK: - Message

    private func formatClaudePrompt() -> String {
        let dateFormatter = DateFormatter()
        dateFormatter.dateStyle = .medium
        var lines: [String] = []

        lines.append("I'm tracking my nutrition today (\(dateFormatter.string(from: selectedDate))). Here's what I've eaten so far and my daily targets. Please suggest what I should eat for my next meal.")
        lines.append("")

        lines.append("## My Daily Targets")
        lines.append("- Calories: \(Int(goal.calories)) kcal")
        lines.append("- Protein: \(Int(goal.protein))g")
        lines.append("- Carbs: \(Int(goal.carbs))g")
        lines.append("- Fat: \(Int(goal.fat))g")
        lines.append("")

        lines.append("## Today's Totals So Far")
        lines.append("- Calories: \(Int(totalCalories)) / \(Int(goal.calories)) kcal")
        lines.append("- Protein: \(Int(totalProtein)) / \(Int(goal.protein))g")
        lines.append("- Carbs: \(Int(totalCarbs)) / \(Int(goal.carbs))g")
        lines.append("- Fat: \(Int(totalFat)) / \(Int(goal.fat))g")
        lines.append("")

        lines.append("## Remaining")
        lines.append("- Calories: \(Int(max(goal.calories - totalCalories, 0))) kcal")
        lines.append("- Protein: \(Int(max(goal.protein - totalProtein, 0)))g")
        lines.append("- Carbs: \(Int(max(goal.carbs - totalCarbs, 0)))g")
        lines.append("- Fat: \(Int(max(goal.fat - totalFat, 0)))g")
        lines.append("")

        lines.append("## What I've Eaten Today")
        var hasAnyMeals = false
        for mealType in MealType.allCases {
            let mealEntries = entries(for: mealType)
            guard !mealEntries.isEmpty else { continue }
            hasAnyMeals = true
            let mealCal = mealEntries.reduce(0) { $0 + $1.calories }
            let mealProtein = mealEntries.reduce(0) { $0 + $1.protein }
            let mealCarbs = mealEntries.reduce(0) { $0 + $1.carbs }
            let mealFat = mealEntries.reduce(0) { $0 + $1.fat }
            lines.append("")
            lines.append("### \(mealType.rawValue) (\(Int(mealCal)) cal, P:\(Int(mealProtein))g C:\(Int(mealCarbs))g F:\(Int(mealFat))g)")
            for entry in mealEntries {
                lines.append("- \(entry.name) (\(Int(entry.calories)) cal, P:\(Int(entry.protein))g C:\(Int(entry.carbs))g F:\(Int(entry.fat))g)")
            }
        }
        if !hasAnyMeals {
            lines.append("Nothing logged yet today.")
        }
        lines.append("")

        let nextMeal = determineNextMeal()
        lines.append("Based on what I've eaten and what I still need, what should I eat for \(nextMeal)? Please suggest a specific meal that helps me hit my remaining macro targets, especially protein. Keep it practical and realistic.")

        return lines.joined(separator: "\n")
    }

    private func determineNextMeal() -> String {
        let hour = Calendar.current.component(.hour, from: Date())
        let hasBreakfast = !entries(for: .breakfast).isEmpty
        let hasLunch = !entries(for: .lunch).isEmpty
        let hasDinner = !entries(for: .dinner).isEmpty

        if !hasBreakfast && hour < 11 {
            return "breakfast"
        } else if !hasLunch && hour < 15 {
            return "lunch"
        } else if !hasDinner && hour < 21 {
            return "dinner"
        } else {
            return "my next meal or snack"
        }
    }

    private func formatDailySummary() -> String {
        let dateFormatter = DateFormatter()
        dateFormatter.dateStyle = .medium
        var lines: [String] = []
        lines.append(dateFormatter.string(from: selectedDate))
        lines.append("")
        lines.append("Calories: \(Int(totalCalories)) / \(Int(goal.calories)) kcal")
        lines.append("Protein: \(Int(totalProtein)) / \(Int(goal.protein))g")
        lines.append("Carbs: \(Int(totalCarbs)) / \(Int(goal.carbs))g")
        lines.append("Fat: \(Int(totalFat)) / \(Int(goal.fat))g")
        for mealType in MealType.allCases {
            let mealEntries = entries(for: mealType)
            guard !mealEntries.isEmpty else { continue }
            let mealCal = mealEntries.reduce(0) { $0 + $1.calories }
            lines.append("")
            lines.append("\(mealType.rawValue) (\(Int(mealCal)) cal)")
            for entry in mealEntries {
                lines.append("- \(entry.name)")
            }
        }
        return lines.joined(separator: "\n")
    }
}

// MARK: - Macro Summary Card

private struct MacroSummaryCard: View {
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
            // Rings
            MacroRingsView(
                calories: calories,
                calorieGoal: calorieGoal,
                protein: protein,
                proteinGoal: proteinGoal,
                carbs: carbs,
                carbsGoal: carbsGoal,
                fat: fat,
                fatGoal: fatGoal
            )

            Divider().padding(.horizontal, 8)

            // Compact progress bars
            VStack(spacing: 8) {
                CompactProgressBar(label: "Protein", current: protein, goal: proteinGoal, color: Color.accent)
                CompactProgressBar(label: "Carbs", current: carbs, goal: carbsGoal, color: Color.highlight)
                CompactProgressBar(label: "Fat", current: fat, goal: fatGoal, color: Color.fatColor)
            }

            // Remaining row
            if calories > 0 {
                Divider().padding(.horizontal, 8)
                HStack(spacing: 16) {
                    RemainingPill(label: "Cal", remaining: calorieGoal - calories, color: Color.highlight)
                    RemainingPill(label: "P", remaining: proteinGoal - protein, color: Color.accent)
                    RemainingPill(label: "C", remaining: carbsGoal - carbs, color: Color.highlight)
                    RemainingPill(label: "F", remaining: fatGoal - fat, color: Color.fatColor)
                }
            }
        }
        .padding()
        .background(Color.cardBackground)
        .clipShape(RoundedRectangle(cornerRadius: 16))
    }
}

private struct CompactProgressBar: View {
    let label: String
    let current: Double
    let goal: Double
    let color: Color

    private var progress: Double {
        guard goal > 0 else { return 0 }
        return min(current / goal, 1.0)
    }

    var body: some View {
        HStack(spacing: 8) {
            Text(label)
                .font(.caption.weight(.medium))
                .frame(width: 50, alignment: .leading)

            GeometryReader { geometry in
                ZStack(alignment: .leading) {
                    RoundedRectangle(cornerRadius: 3)
                        .fill(color.opacity(0.15))
                    RoundedRectangle(cornerRadius: 3)
                        .fill(current > goal ? .red : color)
                        .frame(width: geometry.size.width * progress)
                        .animation(.spring(response: 0.5, dampingFraction: 0.8), value: current)
                }
            }
            .frame(height: 6)

            Text("\(Int(current))/\(Int(goal))g (\(Int(goal > 0 ? current / goal * 100 : 0))%)")
                .font(.system(size: 10, weight: .medium, design: .rounded))
                .foregroundStyle(.secondary)
                .frame(width: 84, alignment: .trailing)
        }
    }
}

private struct RemainingPill: View {
    let label: String
    let remaining: Double
    let color: Color

    var body: some View {
        VStack(spacing: 2) {
            Text(label)
                .font(.system(size: 10, weight: .semibold))
                .foregroundStyle(.secondary)
            Text("\(Int(remaining))")
                .font(.subheadline.bold())
                .foregroundStyle(remaining < 0 ? .red : color)
                .contentTransition(.numericText())
        }
        .frame(maxWidth: .infinity)
    }
}

// MARK: - Edit Entry Sheet

private struct EditEntrySheet: View {
    @Environment(\.modelContext) private var modelContext
    @Environment(\.dismiss) private var dismiss
    @Bindable var entry: DiaryEntry

    private static let servingOptions: [Double] = {
        var values: [Double] = []
        var v = 0.25
        while v <= 5.0 { values.append(v); v += 0.25 }
        v = 5.5
        while v <= 10.0 { values.append(v); v += 0.5 }
        return values
    }()

    private var closestOption: Double {
        Self.servingOptions.min(by: { abs($0 - entry.numberOfServings) < abs($1 - entry.numberOfServings) }) ?? 1.0
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 20) {
                    VStack(spacing: 6) {
                        Text(entry.name)
                            .font(.title2.bold())
                        Text(entry.mealType.rawValue)
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                    }
                    .padding(.top)

                    // Meal type picker
                    VStack(spacing: 8) {
                        Text("Meal")
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(.secondary)
                            .textCase(.uppercase)
                            .tracking(0.5)

                        Picker("Meal", selection: Binding(
                            get: { entry.mealType },
                            set: { entry.mealType = $0 }
                        )) {
                            ForEach(MealType.allCases) { type in
                                Label(type.rawValue, systemImage: type.icon).tag(type)
                            }
                        }
                        .pickerStyle(.segmented)
                    }
                    .padding()
                    .frame(maxWidth: .infinity)
                    .background(Color.cardBackground)
                    .clipShape(RoundedRectangle(cornerRadius: 14))
                    .padding(.horizontal)

                    // Servings wheel picker
                    VStack(spacing: 4) {
                        Text("Number of Servings")
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(.secondary)
                            .textCase(.uppercase)
                            .tracking(0.5)

                        Picker("Servings", selection: Binding(
                            get: { closestOption },
                            set: { entry.numberOfServings = $0 }
                        )) {
                            ForEach(Self.servingOptions, id: \.self) { value in
                                Text(formatNumber(value)).tag(value)
                            }
                        }
                        .pickerStyle(.wheel)
                        .frame(height: 120)
                    }
                    .padding(.horizontal)
                    .padding(.vertical, 8)
                    .frame(maxWidth: .infinity)
                    .background(Color.cardBackground)
                    .clipShape(RoundedRectangle(cornerRadius: 14))
                    .padding(.horizontal)

                    NutritionLabelView(
                        calories: entry.calories,
                        protein: entry.protein,
                        carbs: entry.carbs,
                        fat: entry.fat
                    )
                    .padding(.horizontal)
                    .contentTransition(.numericText())
                    .animation(.default, value: entry.numberOfServings)
                }
            }
            .background(Color.surfaceBackground)
            .navigationTitle("Edit Entry")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") {
                        try? modelContext.save()
                        dismiss()
                    }
                    .bold()
                }
            }
        }
    }

    private func formatNumber(_ value: Double) -> String {
        value.truncatingRemainder(dividingBy: 1) == 0
            ? String(format: "%.0f", value)
            : String(value)
    }
}
