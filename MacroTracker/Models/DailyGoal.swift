import Foundation
import SwiftData

@Model
final class DailyGoal {
    var id: UUID
    var calories: Double
    var protein: Double
    var carbs: Double
    var fat: Double
    /// 0 = default (all days), 1-7 = Calendar weekday (1=Sunday, 2=Monday, ..., 7=Saturday)
    var dayOfWeek: Int

    init(calories: Double = 2000, protein: Double = 150, carbs: Double = 250, fat: Double = 65, dayOfWeek: Int = 0) {
        self.id = UUID()
        self.calories = calories
        self.protein = protein
        self.carbs = carbs
        self.fat = fat
        self.dayOfWeek = dayOfWeek
    }
}
