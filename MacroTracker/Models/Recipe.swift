import Foundation
import SwiftData

@Model
final class Recipe {
    var id: UUID
    var name: String
    var servings: Double

    @Relationship(deleteRule: .cascade)
    var ingredients: [RecipeIngredient]

    @Relationship(inverse: \DiaryEntry.recipe)
    var diaryEntries: [DiaryEntry]?

    var createdAt: Date
    var updatedAt: Date
    var deletedAt: Date?

    init(name: String, servings: Double = 1) {
        self.id = UUID()
        self.name = name
        self.servings = max(servings, 1)
        self.ingredients = []
        self.createdAt = Date()
        self.updatedAt = Date()
        self.deletedAt = nil
    }

    var totalCalories: Double {
        ingredients.reduce(0) { $0 + $1.calories }
    }

    var totalProtein: Double {
        ingredients.reduce(0) { $0 + $1.protein }
    }

    var totalCarbs: Double {
        ingredients.reduce(0) { $0 + $1.carbs }
    }

    var totalFat: Double {
        ingredients.reduce(0) { $0 + $1.fat }
    }

    var caloriesPerServing: Double { totalCalories / servings }
    var proteinPerServing: Double { totalProtein / servings }
    var carbsPerServing: Double { totalCarbs / servings }
    var fatPerServing: Double { totalFat / servings }
}
