import Foundation
import SwiftData

@Model
final class Food {
    var id: UUID
    var name: String
    var brand: String
    var barcode: String
    var calories: Double
    var protein: Double
    var carbs: Double
    var fat: Double
    var servingSize: Double
    var servingUnit: String
    var isCustom: Bool
    var isFavorite: Bool
    var createdAt: Date

    @Relationship(inverse: \DiaryEntry.food)
    var diaryEntries: [DiaryEntry]?

    @Relationship(inverse: \RecipeIngredient.food)
    var recipeIngredients: [RecipeIngredient]?

    init(
        name: String,
        brand: String = "",
        barcode: String = "",
        calories: Double = 0,
        protein: Double = 0,
        carbs: Double = 0,
        fat: Double = 0,
        servingSize: Double = 100,
        servingUnit: String = "g",
        isCustom: Bool = true
    ) {
        self.id = UUID()
        self.name = name
        self.brand = brand
        self.barcode = barcode
        self.calories = calories
        self.protein = protein
        self.carbs = carbs
        self.fat = fat
        self.servingSize = servingSize
        self.servingUnit = servingUnit
        self.isCustom = isCustom
        self.isFavorite = false
        self.createdAt = Date()
    }
}
