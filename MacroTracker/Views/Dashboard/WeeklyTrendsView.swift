import SwiftUI
import Charts

struct WeeklyTrendsView: View {
    let entries: [DiaryEntry]
    let goal: DailyGoal

    private var weekData: [DayData] {
        let calendar = Calendar.current
        let today = calendar.startOfDay(for: Date())
        return (0..<7).reversed().map { offset in
            let date = calendar.date(byAdding: .day, value: -offset, to: today)!
            let dayEntries = entries.filter { calendar.isDate($0.date, inSameDayAs: date) }
            return DayData(
                date: date,
                calories: dayEntries.reduce(0) { $0 + $1.calories },
                protein: dayEntries.reduce(0) { $0 + $1.protein },
                carbs: dayEntries.reduce(0) { $0 + $1.carbs },
                fat: dayEntries.reduce(0) { $0 + $1.fat }
            )
        }
    }

    private var avgCalories: Double {
        let logged = weekData.filter { $0.calories > 0 }
        guard !logged.isEmpty else { return 0 }
        return logged.reduce(0) { $0 + $1.calories } / Double(logged.count)
    }

    private var avgProtein: Double {
        let logged = weekData.filter { $0.calories > 0 }
        guard !logged.isEmpty else { return 0 }
        return logged.reduce(0) { $0 + $1.protein } / Double(logged.count)
    }

    private var avgCarbs: Double {
        let logged = weekData.filter { $0.calories > 0 }
        guard !logged.isEmpty else { return 0 }
        return logged.reduce(0) { $0 + $1.carbs } / Double(logged.count)
    }

    private var avgFat: Double {
        let logged = weekData.filter { $0.calories > 0 }
        guard !logged.isEmpty else { return 0 }
        return logged.reduce(0) { $0 + $1.fat } / Double(logged.count)
    }

    var body: some View {
        VStack(spacing: 16) {
            // 7-day calorie bar chart
            Chart(weekData) { day in
                BarMark(
                    x: .value("Day", day.date, unit: .day),
                    y: .value("Calories", day.calories)
                )
                .foregroundStyle(day.calories > goal.calories ? .red : Color.highlight)
                .cornerRadius(4)

                RuleMark(y: .value("Goal", goal.calories))
                    .lineStyle(StrokeStyle(lineWidth: 1, dash: [5, 3]))
                    .foregroundStyle(Color.accent.opacity(0.5))
            }
            .chartXAxis {
                AxisMarks(values: .stride(by: .day)) { _ in
                    AxisValueLabel(format: .dateTime.weekday(.abbreviated))
                        .font(.caption2)
                }
            }
            .chartYAxis {
                AxisMarks(position: .leading) { _ in
                    AxisValueLabel()
                        .font(.caption2)
                    AxisGridLine()
                }
            }
            .frame(height: 160)

            Divider()

            // Weekly averages
            HStack(spacing: 0) {
                WeeklyAvgColumn(label: "Cal", value: avgCalories, unit: "avg", color: Color.highlight)
                Divider().frame(height: 36)
                WeeklyAvgColumn(label: "Protein", value: avgProtein, unit: "g avg", color: Color.accent)
                Divider().frame(height: 36)
                WeeklyAvgColumn(label: "Carbs", value: avgCarbs, unit: "g avg", color: Color.highlight)
                Divider().frame(height: 36)
                WeeklyAvgColumn(label: "Fat", value: avgFat, unit: "g avg", color: .pink)
            }
        }
        .padding()
        .background(Color.cardBackground)
        .clipShape(RoundedRectangle(cornerRadius: 16))
    }
}

private struct DayData: Identifiable {
    let id = UUID()
    let date: Date
    let calories: Double
    let protein: Double
    let carbs: Double
    let fat: Double
}

private struct WeeklyAvgColumn: View {
    let label: String
    let value: Double
    let unit: String
    let color: Color

    var body: some View {
        VStack(spacing: 2) {
            Text("\(Int(value))")
                .font(.subheadline.bold())
                .foregroundStyle(color)
            Text(unit)
                .font(.caption2)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity)
    }
}
