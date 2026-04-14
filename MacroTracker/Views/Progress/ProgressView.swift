import SwiftUI
import SwiftData
import Charts

struct ProgressTabView: View {
    @Environment(\.modelContext) private var modelContext
    @Query(sort: \DiaryEntry.date) private var diaryEntries: [DiaryEntry]
    @Query private var goals: [DailyGoal]

    @AppStorage("suggestion_dismissed_date") private var suggestionDismissedDate: Double = 0

    @State private var selectedRange: TimeRange = .month
    @State private var selectedMacro: MacroChart = .calories

    private var goal: DailyGoal { goals.goal(for: Date()) }

    enum TimeRange: String, CaseIterable {
        case week = "7D"
        case month = "30D"
        case threeMonths = "90D"
    }

    private func dailyMacroData(_ keyPath: KeyPath<DiaryEntry, Double>) -> [(date: Date, value: Double)] {
        let days: Int
        switch selectedRange {
        case .week: days = 7
        case .month: days = 30
        case .threeMonths: days = 90
        }
        let calendar = Calendar.current
        var result: [(date: Date, value: Double)] = []
        for offset in (0..<days).reversed() {
            guard let date = calendar.date(byAdding: .day, value: -offset, to: Date()) else { continue }
            let start = calendar.startOfDay(for: date)
            let total = diaryEntries
                .filter { calendar.isDate($0.date, inSameDayAs: start) }
                .reduce(0.0) { $0 + $1[keyPath: keyPath] }
            if total > 0 {
                result.append((date: start, value: total))
            }
        }
        return result
    }

    private var dailyCalories: [(date: Date, value: Double)] { dailyMacroData(\.calories) }
    private var dailyProtein: [(date: Date, value: Double)] { dailyMacroData(\.protein) }
    private var dailyCarbs: [(date: Date, value: Double)] { dailyMacroData(\.carbs) }
    private var dailyFat: [(date: Date, value: Double)] { dailyMacroData(\.fat) }

    private var averageCalories: Double {
        guard !dailyCalories.isEmpty else { return 0 }
        return dailyCalories.reduce(0) { $0 + $1.value } / Double(dailyCalories.count)
    }

    private var averageProtein: Double {
        guard !dailyProtein.isEmpty else { return 0 }
        return dailyProtein.reduce(0) { $0 + $1.value } / Double(dailyProtein.count)
    }

    private var averageCarbs: Double {
        guard !dailyCarbs.isEmpty else { return 0 }
        return dailyCarbs.reduce(0) { $0 + $1.value } / Double(dailyCarbs.count)
    }

    private var averageFat: Double {
        guard !dailyFat.isEmpty else { return 0 }
        return dailyFat.reduce(0) { $0 + $1.value } / Double(dailyFat.count)
    }

    private var goalSuggestion: GoalSuggestion? {
        // Don't show if dismissed within last 7 days
        let dismissedDate = Date(timeIntervalSince1970: suggestionDismissedDate)
        guard Date().timeIntervalSince(dismissedDate) > 7 * 24 * 3600 else { return nil }
        return GoalSuggestionService.generate(
            weightEntries: [],
            diaryEntries: diaryEntries,
            goal: goal
        )
    }

    // MARK: - Body

    private var isEmpty: Bool {
        diaryEntries.isEmpty
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

                Image(systemName: "chart.bar.fill")
                    .font(.system(size: 64))
                    .foregroundStyle(Color.accent)

                Text("No Progress Data Yet")
                    .font(.title2.bold())

                Text("Start logging meals to see\nyour trends here.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)

                Spacer()
            }
        }
        .background(Color.surfaceBackground)
        .navigationTitle("Progress")
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

                // Stat cards - 2x2 macro averages
                LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 10) {
                    StatCardView(title: "Avg Calories", value: "\(Int(averageCalories))", icon: "flame.fill", color: .highlight)
                    StatCardView(title: "Avg Protein", value: "\(Int(averageProtein))g", icon: "p.circle.fill", color: .accent)
                    StatCardView(title: "Avg Carbs", value: "\(Int(averageCarbs))g", icon: "c.circle.fill", color: .highlight)
                    StatCardView(title: "Avg Fat", value: "\(Int(averageFat))g", icon: "f.circle.fill", color: .fatColor)
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

                // Daily macros chart
                if !dailyCalories.isEmpty {
                    VStack(alignment: .leading, spacing: 12) {
                        Text("Daily Macros")
                            .font(.subheadline.weight(.semibold))
                            .foregroundStyle(.secondary)

                        // Macro selector
                        HStack(spacing: 6) {
                            ForEach(MacroChart.allCases, id: \.self) { macro in
                                let isSelected = selectedMacro == macro
                                Button {
                                    withAnimation(.easeInOut(duration: 0.2)) {
                                        selectedMacro = macro
                                    }
                                } label: {
                                    VStack(spacing: 2) {
                                        Text(macro.label)
                                            .font(.system(size: 11, weight: .semibold))
                                        Text(macro == .calories
                                             ? "\(Int(selectedAverage(for: macro))) kcal"
                                             : "\(Int(selectedAverage(for: macro)))g")
                                            .font(.system(size: 10, weight: .medium, design: .rounded))
                                            .foregroundStyle(isSelected ? macro.color : .secondary)
                                    }
                                    .frame(maxWidth: .infinity)
                                    .padding(.vertical, 8)
                                    .background(
                                        RoundedRectangle(cornerRadius: 10)
                                            .fill(isSelected ? macro.color.opacity(0.12) : Color.clear)
                                    )
                                    .overlay(
                                        RoundedRectangle(cornerRadius: 10)
                                            .stroke(isSelected ? macro.color.opacity(0.3) : Color.clear, lineWidth: 1)
                                    )
                                }
                                .buttonStyle(.plain)
                            }
                        }

                        // Chart
                        Chart {
                            ForEach(selectedMacroData, id: \.date) { item in
                                BarMark(
                                    x: .value("Date", item.date),
                                    y: .value(selectedMacro.label, item.value)
                                )
                                .foregroundStyle(
                                    item.value > selectedMacroGoal
                                        ? Color.orange.opacity(0.7)
                                        : selectedMacro.color.opacity(0.7)
                                )
                                .cornerRadius(3)
                            }

                            RuleMark(y: .value("Goal", selectedMacroGoal))
                                .foregroundStyle(selectedMacro.color.opacity(0.5))
                                .lineStyle(StrokeStyle(lineWidth: 1, dash: [5, 3]))
                                .annotation(position: .top, alignment: .trailing) {
                                    Text("\(Int(selectedMacroGoal))\(selectedMacro == .calories ? "" : "g")")
                                        .font(.system(size: 9, weight: .medium, design: .rounded))
                                        .foregroundStyle(selectedMacro.color.opacity(0.7))
                                }
                        }
                        .frame(height: 240)
                    }
                    .cardStyle()
                    .padding(.horizontal, 16)
                }

                // Bottom padding for floating tab bar
                Spacer().frame(height: 80)
            }
            .padding(.top, 8)
        }
        .background(Color.surfaceBackground)
        .navigationTitle("Progress")
    }

    // MARK: - Macro Chart Helpers

    private var selectedMacroData: [(date: Date, value: Double)] {
        switch selectedMacro {
        case .calories: return dailyCalories
        case .protein: return dailyProtein
        case .carbs: return dailyCarbs
        case .fat: return dailyFat
        }
    }

    private var selectedMacroGoal: Double {
        switch selectedMacro {
        case .calories: return goal.calories
        case .protein: return goal.protein
        case .carbs: return goal.carbs
        case .fat: return goal.fat
        }
    }

    private func selectedAverage(for macro: MacroChart) -> Double {
        switch macro {
        case .calories: return averageCalories
        case .protein: return averageProtein
        case .carbs: return averageCarbs
        case .fat: return averageFat
        }
    }
}

// MARK: - Macro Chart Type

private enum MacroChart: String, CaseIterable {
    case calories = "Cal"
    case protein = "Pro"
    case carbs = "Carb"
    case fat = "Fat"

    var label: String {
        switch self {
        case .calories: return "Calories"
        case .protein: return "Protein"
        case .carbs: return "Carbs"
        case .fat: return "Fat"
        }
    }

    var color: Color {
        switch self {
        case .calories: return Color.highlight
        case .protein: return Color.accent
        case .carbs: return Color.highlight
        case .fat: return Color.fatColor
        }
    }
}

// MARK: - Stat Card

private struct StatCardView: View {
    let title: String
    let value: String
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
            Text(title)
                .font(.system(size: 10))
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 14)
        .background(
            RoundedRectangle(cornerRadius: 14)
                .fill(Color.cardBackground)
                .overlay(
                    RoundedRectangle(cornerRadius: 14)
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
