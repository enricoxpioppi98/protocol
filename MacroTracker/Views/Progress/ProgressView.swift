import SwiftUI
import SwiftData
import Charts

struct ProgressTabView: View {
    @Environment(\.modelContext) private var modelContext
    @Query(sort: \WeightEntry.date) private var weightEntries: [WeightEntry]
    @Query(sort: \DiaryEntry.date) private var diaryEntries: [DiaryEntry]
    @Query private var goals: [DailyGoal]

    @State private var showAddWeight = false
    @State private var weightText = ""
    @State private var noteText = ""
    @State private var selectedRange: TimeRange = .month

    private var goal: DailyGoal { goals.first ?? DailyGoal() }

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

    /// Daily calorie averages for the chart
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

    // MARK: - Body

    var body: some View {
        NavigationStack {
            List {
                // Time range picker
                Section {
                    Picker("Range", selection: $selectedRange) {
                        ForEach(TimeRange.allCases, id: \.self) { range in
                            Text(range.rawValue).tag(range)
                        }
                    }
                    .pickerStyle(.segmented)
                    .listRowBackground(Color.clear)
                    .listRowInsets(EdgeInsets())
                }

                // Stats cards
                Section {
                    HStack(spacing: 12) {
                        StatCard(
                            title: "Avg Calories",
                            value: "\(Int(averageCalories))",
                            unit: "kcal",
                            icon: "flame.fill",
                            color: Color.highlight
                        )
                        StatCard(
                            title: "Avg Weight",
                            value: averageWeight > 0 ? String(format: "%.1f", averageWeight) : "—",
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
                }
                .listRowInsets(EdgeInsets(top: 4, leading: 0, bottom: 4, trailing: 0))
                .listRowBackground(Color.clear)

                // Weight chart
                if !filteredWeights.isEmpty {
                    Section("Weight Trend") {
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
                }

                // Calorie chart
                if !dailyCalories.isEmpty {
                    Section("Daily Calories") {
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
                }

                // Weight log
                Section {
                    Button {
                        showAddWeight = true
                    } label: {
                        Label("Log Weight", systemImage: "plus.circle.fill")
                            .font(.subheadline.weight(.semibold))
                            .foregroundStyle(Color.accent)
                    }

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
                        .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                            Button(role: .destructive) {
                                modelContext.delete(entry)
                                try? modelContext.save()
                            } label: {
                                Label("Delete", systemImage: "trash")
                            }
                        }
                    }
                } header: {
                    Text("Weight Log")
                }
            }
            .navigationTitle("Progress")
            .sheet(isPresented: $showAddWeight) {
                addWeightSheet
            }
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
            Text(unit)
                .font(.system(size: 9))
                .foregroundStyle(.secondary)
            Text(title)
                .font(.system(size: 9))
                .foregroundStyle(.tertiary)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 12)
        .background(Color.cardBackground)
        .clipShape(RoundedRectangle(cornerRadius: 12))
    }
}
