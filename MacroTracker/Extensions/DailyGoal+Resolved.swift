import Foundation

extension Array where Element == DailyGoal {
    /// Returns the goal for a specific date, checking for day-of-week overrides first,
    /// then falling back to the default goal (dayOfWeek == 0).
    func goal(for date: Date) -> DailyGoal {
        let weekday = Calendar.current.component(.weekday, from: date)
        // Try day-specific override first
        if let specific = first(where: { $0.dayOfWeek == weekday }) {
            return specific
        }
        // Fall back to default
        return first(where: { $0.dayOfWeek == 0 }) ?? DailyGoal()
    }

    /// Returns the default goal (dayOfWeek == 0).
    var defaultGoal: DailyGoal? {
        first(where: { $0.dayOfWeek == 0 })
    }
}
