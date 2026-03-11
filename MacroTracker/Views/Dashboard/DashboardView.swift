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
    @State private var quickAddToast: String?

    private var goal: DailyGoal {
        goals.first ?? DailyGoal()
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

    /// Recent entries from last 7 days (excluding today) for quick-add
    private var recentEntries: [DiaryEntry] {
        let calendar = Calendar.current
        let weekAgo = calendar.date(byAdding: .day, value: -7, to: selectedDate) ?? selectedDate
        return allEntries.filter {
            $0.date >= calendar.startOfDay(for: weekAgo)
            && !calendar.isDate($0.date, inSameDayAs: selectedDate)
        }
    }

    /// Consecutive days with at least one logged entry, counting back from yesterday
    private var currentStreak: Int {
        let calendar = Calendar.current
        let today = calendar.startOfDay(for: Date())
        var streak = 0

        // Check if today has entries — if so, count today
        let todayHasEntries = allEntries.contains { calendar.isDate($0.date, inSameDayAs: today) }
        if todayHasEntries { streak = 1 }

        // Count consecutive past days
        for offset in 1..<365 {
            guard let date = calendar.date(byAdding: .day, value: -offset, to: today) else { break }
            let hasEntries = allEntries.contains { calendar.isDate($0.date, inSameDayAs: date) }
            if hasEntries {
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

    private func changeDate(by days: Int) {
        // Commit any pending deletion before changing date
        commitPendingDeletion()
        withAnimation(.easeInOut(duration: 0.2)) {
            selectedDate = Calendar.current.date(byAdding: .day, value: days, to: selectedDate) ?? selectedDate
        }
        UIImpactFeedbackGenerator(style: .light).impactOccurred()
    }

    var body: some View {
        NavigationStack {
            Group {
                if todayEntries.isEmpty && goals.isEmpty {
                    emptyStateView
                } else {
                    mainListView
                }
            }
            .navigationTitle("MacroTracker")
            .toolbar {
                ToolbarItem(placement: .primaryAction) {
                    Button {
                        if DailySummaryMessageView.canSendText {
                            showMessageCompose = true
                        } else {
                            showMessageUnavailable = true
                        }
                    } label: {
                        Image(systemName: "message.fill")
                    }
                }
                ToolbarItem(placement: .secondaryAction) {
                    Button {
                        showCopyConfirmation = true
                    } label: {
                        Label("Copy Yesterday", systemImage: "doc.on.doc")
                    }
                    .disabled(yesterdayEntries.isEmpty)
                }
            }
            .gesture(
                DragGesture(minimumDistance: 50, coordinateSpace: .local)
                    .onEnded { value in
                        if value.translation.width > 80 {
                            changeDate(by: -1)
                        } else if value.translation.width < -80 {
                            changeDate(by: 1)
                        }
                    }
            )
            .sheet(item: $addingMealType) { mealType in
                FoodSearchView(mealType: mealType, date: selectedDate)
            }
            .sheet(item: $editingEntry) { entry in
                EditEntrySheet(entry: entry)
            }
            .sheet(isPresented: $showMessageCompose) {
                DailySummaryMessageView(messageBody: formatDailySummary())
                    .ignoresSafeArea()
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
                            .font(.headline)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 14)
                            .background(Color.accent)
                            .foregroundStyle(.white)
                            .clipShape(RoundedRectangle(cornerRadius: 14))
                    }

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
                }
                .padding(.horizontal, 24)

                Spacer()
            }
        }
        .background(Color.surfaceBackground)
    }

    // MARK: - Main List

    private var mainListView: some View {
        List {
            // Streak banner
            if Calendar.current.isDateInToday(selectedDate) {
                Section {
                    StreakBannerView(
                        streak: currentStreak,
                        todayCalories: totalCalories,
                        calorieGoal: goal.calories,
                        todayProtein: totalProtein,
                        proteinGoal: goal.protein
                    )
                }
                .listRowInsets(EdgeInsets())
                .listRowBackground(Color.clear)
            }

            // Date picker
            Section {
                DatePicker("Date", selection: $selectedDate, displayedComponents: .date)
                    .datePickerStyle(.compact)
                    .tint(Color.accent)

                HStack {
                    Button { changeDate(by: -1) } label: {
                        Image(systemName: "chevron.left")
                            .font(.body.weight(.semibold))
                    }

                    Spacer()

                    if Calendar.current.isDateInToday(selectedDate) {
                        Text("Today")
                            .font(.headline)
                    } else {
                        Button("Go to Today") {
                            commitPendingDeletion()
                            withAnimation { selectedDate = Date() }
                        }
                        .font(.subheadline.weight(.medium))
                    }

                    Spacer()

                    Button { changeDate(by: 1) } label: {
                        Image(systemName: "chevron.right")
                            .font(.body.weight(.semibold))
                    }
                }
                .buttonStyle(.plain)
                .tint(Color.accent)
            }

            // Macro rings
            Section {
                MacroRingsView(
                    calories: totalCalories,
                    calorieGoal: goal.calories,
                    protein: totalProtein,
                    proteinGoal: goal.protein,
                    carbs: totalCarbs,
                    carbsGoal: goal.carbs,
                    fat: totalFat,
                    fatGoal: goal.fat
                )
                .frame(maxWidth: .infinity)
            }
            .listRowInsets(EdgeInsets())
            .listRowBackground(Color.clear)

            // Macro progress bars
            Section("Macros") {
                MacroProgressBar(label: "Calories", current: totalCalories, goal: goal.calories, color: Color.highlight, unit: "kcal")
                MacroProgressBar(label: "Protein", current: totalProtein, goal: goal.protein, color: Color.accent, unit: "g")
                MacroProgressBar(label: "Carbs", current: totalCarbs, goal: goal.carbs, color: Color.highlight, unit: "g")
                MacroProgressBar(label: "Fat", current: totalFat, goal: goal.fat, color: .pink, unit: "g")
            }

            // Quick Add recent foods
            if Calendar.current.isDateInToday(selectedDate) && !recentEntries.isEmpty {
                Section("Quick Add") {
                    QuickAddView(
                        recentEntries: recentEntries,
                        date: selectedDate,
                        onQuickAdd: { entry in
                            quickAddEntry(from: entry)
                        }
                    )
                }
                .listRowInsets(EdgeInsets())
                .listRowBackground(Color.clear)
            }

            // Meal sections
            ForEach(MealType.allCases) { mealType in
                MealSectionView(
                    mealType: mealType,
                    entries: entries(for: mealType),
                    onAdd: {
                        addingMealType = mealType
                    },
                    onDelete: { entry in
                        stageForDeletion(entry)
                    },
                    onEdit: { entry in
                        editingEntry = entry
                    }
                )
            }

            // Weekly trends
            Section("Weekly Trends") {
                WeeklyTrendsView(entries: allEntries, goal: goal)
                    .listRowInsets(EdgeInsets())
                    .listRowBackground(Color.clear)
            }
        }
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
            .padding(.bottom, 8)
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
        // Commit any previous pending deletion
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

    private func formatDailySummary() -> String {
        let dateFormatter = DateFormatter()
        dateFormatter.dateStyle = .medium

        var lines: [String] = []
        lines.append("MacroTracker - \(dateFormatter.string(from: selectedDate))")
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
                let servingsStr = String(format: "%.1f", entry.numberOfServings)
                lines.append("- \(entry.name) x\(servingsStr)")
            }
        }

        return lines.joined(separator: "\n")
    }
}

// MARK: - Edit Entry Sheet

private struct EditEntrySheet: View {
    @Environment(\.modelContext) private var modelContext
    @Environment(\.dismiss) private var dismiss
    @Bindable var entry: DiaryEntry

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 20) {
                    // Entry name header
                    VStack(spacing: 6) {
                        Text(entry.name)
                            .font(.title2.bold())
                        Text(entry.mealType.rawValue)
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                    }
                    .padding(.top)

                    // Serving count editor
                    VStack(spacing: 8) {
                        Text("Number of Servings")
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(.secondary)
                            .textCase(.uppercase)
                            .tracking(0.5)

                        HStack(spacing: 20) {
                            Button {
                                if entry.numberOfServings > 0.5 {
                                    entry.numberOfServings -= 0.5
                                    UIImpactFeedbackGenerator(style: .light).impactOccurred()
                                }
                            } label: {
                                Image(systemName: "minus.circle.fill")
                                    .font(.title2)
                            }

                            Text(String(format: "%.1f", entry.numberOfServings))
                                .font(.system(size: 28, weight: .bold, design: .rounded))
                                .frame(width: 60)

                            Button {
                                entry.numberOfServings += 0.5
                                UIImpactFeedbackGenerator(style: .light).impactOccurred()
                            } label: {
                                Image(systemName: "plus.circle.fill")
                                    .font(.title2)
                            }
                        }
                        .tint(Color.accent)
                    }
                    .padding()
                    .frame(maxWidth: .infinity)
                    .background(Color.cardBackground)
                    .clipShape(RoundedRectangle(cornerRadius: 14))
                    .padding(.horizontal)

                    // Live nutrition preview
                    NutritionLabelView(
                        calories: entry.calories,
                        protein: entry.protein,
                        carbs: entry.carbs,
                        fat: entry.fat
                    )
                    .padding(.horizontal)
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
}
