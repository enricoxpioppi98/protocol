import SwiftUI
import SwiftData
import Charts

struct ProgressTabView: View {
    @Environment(\.modelContext) private var modelContext
    @Query(sort: \WeightEntry.date) private var weightEntries: [WeightEntry]
    @Query(sort: \DiaryEntry.date) private var diaryEntries: [DiaryEntry]
    @Query private var goals: [DailyGoal]

    @AppStorage("suggestion_dismissed_date") private var suggestionDismissedDate: Double = 0

    @State private var showAddWeight = false
    @State private var weightText = ""
    @State private var noteText = ""
    @State private var selectedRange: TimeRange = .month

    private var goal: DailyGoal { goals.goal(for: Date()) }

    enum TimeRange: String, CaseIterable {
        case week = "7D"
        case month = "30D"
        case threeMonths = "90D"
    }

    private var filteredWeights: [WeightEntry] {
        let days: Int
        switch selectedRange {
        case .week: days = 7
        case .month: days = 30
        case .threeMonths: days = 90
        }
        let cutoff = Calendar.current.date(byAdding: .day, value: -days, to: Date()) ?? Date()
        return weightEntries.filter { $0.date >= cutoff }
    }

    private var weightChange: Double? {
        guard let first = filteredWeights.first, let last = filteredWeights.last, first.id != last.id else {
            return nil
        }
        return last.weight - first.weight
    }

    private var dailyCalories: [(date: Date, calories: Double)] {
        let days: Int
        switch selectedRange {
        case .week: days = 7
        case .month: days = 30
        case .threeMonths: days = 90
        }
        let calendar = Calendar.current
        var result: [(date: Date, calories: Double)] = []
        for offset in (0..<days).reversed() {
            guard let date = calendar.date(byAdding: .day, value: -offset, to: Date()) else { continue }
            let start = calendar.startOfDay(for: date)
            let total = diaryEntries
                .filter { calendar.isDate($0.date, inSameDayAs: start) }
                .reduce(0.0) { $0 + $1.calories }
            if total > 0 {
                result.append((date: start, calories: total))
            }
        }
        return result
    }

    private var averageCalories: Double {
        guard !dailyCalories.isEmpty else { return 0 }
        return dailyCalories.reduce(0) { $0 + $1.calories } / Double(dailyCalories.count)
    }

    private var averageWeight: Double {
        guard !filteredWeights.isEmpty else { return 0 }
        return filteredWeights.reduce(0) { $0 + $1.weight } / Double(filteredWeights.count)
    }

    private var goalSuggestion: GoalSuggestion? {
        // Don't show if dismissed within last 7 days
        let dismissedDate = Date(timeIntervalSince1970: suggestionDismissedDate)
        guard Date().timeIntervalSince(dismissedDate) > 7 * 24 * 3600 else { return nil }
        return GoalSuggestionService.generate(
            weightEntries: weightEntries,
            diaryEntries: diaryEntries,
            goal: goal
        )
    }

    // MARK: - Body

    private var isEmpty: Bool {
        weightEntries.isEmpty && diaryEntries.isEmpty
    }

    var body: some View {
        NavigationStack {
            if isEmpty {
                emptyStateView
            } else {
                mainContent
            }
        }
    }

    private var emptyStateView: some View {
        ScrollView {
            VStack(spacing: 24) {
                Spacer().frame(height: 60)

                Image(systemName: "chart.line.uptrend.xyaxis.circle.fill")
                    .font(.system(size: 64))
                    .foregroundStyle(Color.accent)

                Text("No Progress Data Yet")
                    .font(.title2.bold())

                Text("Start logging meals and weight\nto see your trends here.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)

                Button {
                    showAddWeight = true
                } label: {
                    Label("Log Your First Weight", systemImage: "scalemass.fill")
                }
                .buttonStyle(PrimaryButtonStyle())
                .padding(.horizontal, 24)

                Spacer()
            }
        }
        .background(Color.surfaceBackground)
        .navigationTitle("Progress")
        .sheet(isPresented: $showAddWeight) {
            addWeightSheet
        }
    }

    private var mainContent: some View {
        ScrollView {
            VStack(spacing: 12) {
                // Time range picker
                    Picker("Range", selection: $selectedRange) {
                        ForEach(TimeRange.allCases, id: \.self) { range in
                            Text(range.rawValue).tag(range)
                        }
                    }
                    .pickerStyle(.segmented)
                    .padding(.horizontal, 16)

                    // Stats cards
                    HStack(spacing: 10) {
                        StatCard(
                            title: "Avg Calories",
                            value: "\(Int(averageCalories))",
                            unit: "kcal",
                            icon: "flame.fill",
                            color: Color.highlight
                        )
                        StatCard(
                            title: "Avg Weight",
                            value: averageWeight > 0 ? String(format: "%.1f", averageWeight) : "--",
                            unit: averageWeight > 0 ? "lbs" : "",
                            icon: "scalemass.fill",
                            color: Color.accent
                        )
                        if let change = weightChange {
                            StatCard(
                                title: "Change",
                                value: String(format: "%+.1f", change),
                                unit: "lbs",
                                icon: change < 0 ? "arrow.down.right" : "arrow.up.right",
                                color: change < 0 ? .green : (change > 0 ? .orange : .secondary)
                            )
                        }
                    }
                    .padding(.horizontal, 16)

                    // Goal suggestion banner
                    if let suggestion = goalSuggestion {
                        GoalSuggestionBanner(suggestion: suggestion) {
                            withAnimation {
                                suggestionDismissedDate = Date().timeIntervalSince1970
                            }
                        }
                        .padding(.horizontal, 16)
                        .transition(.opacity.combined(with: .move(edge: .top)))
                    }

                    // Weight chart
                    if !filteredWeights.isEmpty {
                        VStack(alignment: .leading, spacing: 10) {
                            Text("Weight Trend")
                                .font(.subheadline.weight(.semibold))
                                .foregroundStyle(.secondary)

                            Chart(filteredWeights) { entry in
                                LineMark(
                                    x: .value("Date", entry.date),
                                    y: .value("Weight", entry.weight)
                                )
                                .foregroundStyle(Color.accent)
                                .interpolationMethod(.catmullRom)

                                AreaMark(
                                    x: .value("Date", entry.date),
                                    y: .value("Weight", entry.weight)
                                )
                                .foregroundStyle(
                                    LinearGradient(
                                        colors: [Color.accent.opacity(0.2), Color.accent.opacity(0.0)],
                                        startPoint: .top,
                                        endPoint: .bottom
                                    )
                                )
                                .interpolationMethod(.catmullRom)

                                PointMark(
                                    x: .value("Date", entry.date),
                                    y: .value("Weight", entry.weight)
                                )
                                .foregroundStyle(Color.accent)
                                .symbolSize(20)
                            }
                            .chartYScale(domain: weightYDomain)
                            .frame(height: 180)
                        }
                        .cardStyle()
                        .padding(.horizontal, 16)
                    }

                    // Calorie chart
                    if !dailyCalories.isEmpty {
                        VStack(alignment: .leading, spacing: 10) {
                            Text("Daily Calories")
                                .font(.subheadline.weight(.semibold))
                                .foregroundStyle(.secondary)

                            Chart {
                                ForEach(dailyCalories, id: \.date) { item in
                                    BarMark(
                                        x: .value("Date", item.date),
                                        y: .value("Calories", item.calories)
                                    )
                                    .foregroundStyle(
                                        item.calories > goal.calories
                                            ? Color.orange.opacity(0.7)
                                            : Color.highlight.opacity(0.7)
                                    )
                                    .cornerRadius(3)
                                }

                                RuleMark(y: .value("Goal", goal.calories))
                                    .foregroundStyle(Color.accent)
                                    .lineStyle(StrokeStyle(lineWidth: 1, dash: [5, 3]))
                                    .annotation(position: .top, alignment: .trailing) {
                                        Text("Goal")
                                            .font(.system(size: 9, weight: .medium))
                                            .foregroundStyle(Color.accent)
                                    }
                            }
                            .frame(height: 160)
                        }
                        .cardStyle()
                        .padding(.horizontal, 16)
                    }

                    // Weight log
                    VStack(spacing: 0) {
                        HStack {
                            Text("Weight Log")
                                .font(.subheadline.weight(.semibold))
                                .foregroundStyle(.secondary)
                            Spacer()
                            Button {
                                showAddWeight = true
                            } label: {
                                HStack(spacing: 4) {
                                    Image(systemName: "plus")
                                        .font(.caption.weight(.bold))
                                    Text("Log")
                                        .font(.caption.weight(.semibold))
                                }
                                .foregroundStyle(Color.accent)
                                .padding(.horizontal, 12)
                                .padding(.vertical, 6)
                                .background(Color.accent.opacity(0.08))
                                .clipShape(Capsule())
                            }
                            .buttonStyle(ScaleButtonStyle())
                        }
                        .padding(.horizontal, 16)
                        .padding(.vertical, 12)

                        if filteredWeights.isEmpty {
                            Text("No weight entries yet")
                                .font(.caption)
                                .foregroundStyle(.tertiary)
                                .padding(.vertical, 20)
                        } else {
                            ForEach(filteredWeights.reversed()) { entry in
                                HStack {
                                    VStack(alignment: .leading, spacing: 2) {
                                        Text(entry.date.formatted(.dateTime.month(.abbreviated).day()))
                                            .font(.subheadline.weight(.medium))
                                        if !entry.note.isEmpty {
                                            Text(entry.note)
                                                .font(.caption)
                                                .foregroundStyle(.secondary)
                                                .lineLimit(1)
                                        }
                                    }
                                    Spacer()
                                    Text(String(format: "%.1f", entry.weight))
                                        .font(.subheadline.bold())
                                        .foregroundStyle(Color.accent)
                                    Text("lbs")
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                }
                                .padding(.horizontal, 16)
                                .padding(.vertical, 8)
                                .contextMenu {
                                    Button(role: .destructive) {
                                        modelContext.delete(entry)
                                        try? modelContext.save()
                                    } label: {
                                        Label("Delete", systemImage: "trash")
                                    }
                                }

                                if entry.id != filteredWeights.first?.id {
                                    Divider().padding(.leading, 16)
                                }
                            }
                        }
                    }
                    .background(Color.cardBackground)
                    .clipShape(RoundedRectangle(cornerRadius: 16))
                    .padding(.horizontal, 16)

                    // Bottom padding for floating tab bar
                    Spacer().frame(height: 80)
                }
                .padding(.top, 8)
            }
            .background(Color.surfaceBackground)
            .navigationTitle("Progress")
            .sheet(isPresented: $showAddWeight) {
                addWeightSheet
            }
    }

    // MARK: - Helpers

    private var weightYDomain: ClosedRange<Double> {
        let weights = filteredWeights.map(\.weight)
        let minW = (weights.min() ?? 100) - 2
        let maxW = (weights.max() ?? 200) + 2
        return minW...maxW
    }

    // MARK: - Add Weight Sheet

    private var addWeightSheet: some View {
        NavigationStack {
            Form {
                Section("Weight") {
                    HStack {
                        TextField("e.g. 175", text: $weightText)
                            .keyboardType(.decimalPad)
                            .font(.system(size: 24, weight: .bold, design: .rounded))
                        Text("lbs")
                            .foregroundStyle(.secondary)
                    }
                }
                Section("Note (optional)") {
                    TextField("e.g. morning, post-workout", text: $noteText)
                }
            }
            .navigationTitle("Log Weight")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") {
                        showAddWeight = false
                        weightText = ""
                        noteText = ""
                    }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") {
                        saveWeight()
                    }
                    .bold()
                    .disabled(Double(weightText) == nil)
                }
            }
        }
        .presentationDetents([.medium])
        .presentationCornerRadius(24)
    }

    private func saveWeight() {
        guard let weight = Double(weightText), weight > 0 else { return }
        let entry = WeightEntry(weight: weight, note: noteText)
        modelContext.insert(entry)
        try? modelContext.save()
        UINotificationFeedbackGenerator().notificationOccurred(.success)
        showAddWeight = false
        weightText = ""
        noteText = ""
    }
}

// MARK: - Stat Card

private struct StatCard: View {
    let title: String
    let value: String
    let unit: String
    let icon: String
    let color: Color

    var body: some View {
        VStack(spacing: 6) {
            Image(systemName: icon)
                .font(.caption)
                .foregroundStyle(color)
            Text(value)
                .font(.system(size: 18, weight: .bold, design: .rounded))
                .contentTransition(.numericText())
            Text(unit)
                .font(.system(size: 9))
                .foregroundStyle(.secondary)
            Text(title)
                .font(.system(size: 9))
                .foregroundStyle(.tertiary)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 12)
        .background(
            RoundedRectangle(cornerRadius: 12)
                .fill(Color.cardBackground)
                .overlay(
                    RoundedRectangle(cornerRadius: 12)
                        .fill(
                            LinearGradient(
                                colors: [color.opacity(0.06), Color.clear],
                                startPoint: .top,
                                endPoint: .bottom
                            )
                        )
                )
        )
    }
}
