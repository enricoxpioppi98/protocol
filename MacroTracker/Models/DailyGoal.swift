import Foundation
import SwiftData

@Model
final class DailyGoal {
    var id: UUID
    var calories: Double
    var protein: Double
    var carbs: Double
    var fat: Double

    init(calories: Double = 2000, protein: Double = 150, carbs: Double = 250, fat: Double = 65) {
        self.id = UUID()
        self.calories = calories
        self.protein = protein
        self.carbs = carbs
        self.fat = fat
    }
}
