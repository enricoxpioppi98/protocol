import SwiftUI

struct GoalSuggestion {
    let message: String
    let detail: String
    let icon: String
    let tintColor: Color
}

enum GoalSuggestionService {
    /// Generates a goal suggestion based on weight and calorie trends.
    /// Returns nil if insufficient data (< 7 weight entries or < 5 days of diary data).
    static func generate(
        weightEntries: [WeightEntry],
        diaryEntries: [DiaryEntry],
        goal: DailyGoal
    ) -> GoalSuggestion? {
        let calendar = Calendar.current
        let now = Date()

        // Need at least 7 weight entries spanning at least 7 days
        let recentWeights = weightEntries
            .filter { $0.date >= calendar.date(byAdding: .day, value: -30, to: now)! }
            .sorted { $0.date < $1.date }

        guard recentWeights.count >= 7 else { return nil }

        // Need at least 5 unique days of diary entries
        let recentDiary = diaryEntries
            .filter { $0.date >= calendar.date(byAdding: .day, value: -14, to: now)! }
        let uniqueDays = Set(recentDiary.map { calendar.startOfDay(for: $0.date) })
        guard uniqueDays.count >= 5 else { return nil }

        // Calculate weight change rate (lbs per week)
        guard let firstWeight = recentWeights.first,
              let lastWeight = recentWeights.last,
              firstWeight.id != lastWeight.id else { return nil }

        let daySpan = calendar.dateComponents([.day], from: firstWeight.date, to: lastWeight.date).day ?? 1
        guard daySpan >= 7 else { return nil }

        let totalChange = lastWeight.weight - firstWeight.weight
        let weeklyChange = totalChange / (Double(daySpan) / 7.0)

        // Calculate average daily calories
        var dailyTotals: [Double] = []
        for day in uniqueDays {
            let dayEntries = recentDiary.filter { calendar.isDate($0.date, inSameDayAs: day) }
            let total = dayEntries.reduce(0.0) { $0 + $1.calories }
            if total > 0 { dailyTotals.append(total) }
        }
        guard !dailyTotals.isEmpty else { return nil }
        let avgCalories = dailyTotals.reduce(0, +) / Double(dailyTotals.count)
        let calorieDiff = avgCalories - goal.calories

        // Generate suggestion based on trends
        if weeklyChange < -2.0 {
            // Losing too fast
            return GoalSuggestion(
                message: "Rapid weight loss detected",
                detail: "You're losing \(String(format: "%.1f", abs(weeklyChange))) lbs/week. Consider adding ~200 cal/day to preserve muscle mass.",
                icon: "exclamationmark.triangle.fill",
                tintColor: .orange
            )
        } else if weeklyChange < -0.5 {
            // Healthy loss
            return GoalSuggestion(
                message: "Great progress!",
                detail: "You're losing \(String(format: "%.1f", abs(weeklyChange))) lbs/week — a healthy, sustainable rate.",
                icon: "checkmark.seal.fill",
                tintColor: .green
            )
        } else if weeklyChange <= 0.3 && weeklyChange >= -0.3 {
            // Maintaining
            if calorieDiff > 100 {
                return GoalSuggestion(
                    message: "Weight is stable",
                    detail: "You're averaging \(Int(avgCalories)) cal/day (goal: \(Int(goal.calories))). Reduce by ~150 cal to start losing.",
                    icon: "arrow.right.circle.fill",
                    tintColor: Color.accent
                )
            } else if calorieDiff < -200 {
                return GoalSuggestion(
                    message: "Eating under goal",
                    detail: "You're averaging \(Int(avgCalories)) cal/day — \(Int(abs(calorieDiff))) below goal. Your weight is stable, which is positive.",
                    icon: "info.circle.fill",
                    tintColor: Color.accent
                )
            }
            return nil
        } else if weeklyChange > 0.3 {
            // Gaining
            if calorieDiff > 200 {
                return GoalSuggestion(
                    message: "Above calorie goal",
                    detail: "You're gaining \(String(format: "%.1f", weeklyChange)) lbs/week and averaging \(Int(calorieDiff)) cal above goal. Try staying closer to target.",
                    icon: "exclamationmark.triangle.fill",
                    tintColor: .orange
                )
            } else {
                return GoalSuggestion(
                    message: "Gradual weight gain",
                    detail: "You're gaining \(String(format: "%.1f", weeklyChange)) lbs/week. If this isn't intentional, consider reducing by ~100–200 cal.",
                    icon: "arrow.up.right.circle.fill",
                    tintColor: .orange
                )
            }
        }

        return nil
    }
}
