import Foundation
import SwiftData

@Model
final class DiaryEntry {
    var id: UUID
    var date: Date
    var mealTypeRaw: String
    var numberOfServings: Double
    var updatedAt: Date
    var deletedAt: Date?

    var food: Food?
    var recipe: Recipe?

    init(date: Date, mealType: MealType, food: Food? = nil, recipe: Recipe? = nil, numberOfServings: Double = 1) {
        self.id = UUID()
        self.date = Calendar.current.startOfDay(for: date)
        self.mealTypeRaw = mealType.rawValue
        self.food = food
        self.recipe = recipe
        self.numberOfServings = numberOfServings
        self.updatedAt = Date()
        self.deletedAt = nil
    }

    var mealType: MealType {
        get { MealType(rawValue: mealTypeRaw) ?? .snack }
        set { mealTypeRaw = newValue.rawValue }
    }

    var name: String {
        if let food { return food.name }
        if let recipe { return recipe.name }
        return "Unknown"
    }

    var calories: Double {
        if let food { return food.calories * numberOfServings }
        if let recipe { return recipe.caloriesPerServing * numberOfServings }
        return 0
    }

    var protein: Double {
        if let food { return food.protein * numberOfServings }
        if let recipe { return recipe.proteinPerServing * numberOfServings }
        return 0
    }

    var carbs: Double {
        if let food { return food.carbs * numberOfServings }
        if let recipe { return recipe.carbsPerServing * numberOfServings }
        return 0
    }

    var fat: Double {
        if let food { return food.fat * numberOfServings }
        if let recipe { return recipe.fatPerServing * numberOfServings }
        return 0
    }

    var fiber: Double {
        if let food { return (food.fiber) * numberOfServings }
        if let recipe { return recipe.fiberPerServing * numberOfServings }
        return 0
    }
}
