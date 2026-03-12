import Foundation
import SwiftData

@Model
final class MealTemplate {
    var id: UUID
    var name: String
    var mealTypeRaw: String
    var createdAt: Date

    @Relationship(deleteRule: .cascade)
    var items: [MealTemplateItem]

    init(name: String, mealType: MealType) {
        self.id = UUID()
        self.name = name
        self.mealTypeRaw = mealType.rawValue
        self.createdAt = Date()
        self.items = []
    }

    var mealType: MealType {
        get { MealType(rawValue: mealTypeRaw) ?? .snack }
        set { mealTypeRaw = newValue.rawValue }
    }

    var totalCalories: Double {
        items.reduce(0) { $0 + ($1.food?.calories ?? 0) * $1.numberOfServings }
    }

    var totalProtein: Double {
        items.reduce(0) { $0 + ($1.food?.protein ?? 0) * $1.numberOfServings }
    }
}

@Model
final class MealTemplateItem {
    var id: UUID
    var numberOfServings: Double
    var food: Food?
    var template: MealTemplate?

    init(food: Food, numberOfServings: Double = 1) {
        self.id = UUID()
        self.food = food
        self.numberOfServings = numberOfServings
    }
}
