import Foundation
import SwiftData

@Model
final class RecipeIngredient {
    var id: UUID
    var quantity: Double // number of servings of the food

    var food: Food?
    var recipe: Recipe?

    init(food: Food, quantity: Double = 1) {
        self.id = UUID()
        self.food = food
        self.quantity = quantity
    }

    var calories: Double {
        guard let food else { return 0 }
        return food.calories * quantity
    }

    var protein: Double {
        guard let food else { return 0 }
        return food.protein * quantity
    }

    var carbs: Double {
        guard let food else { return 0 }
        return food.carbs * quantity
    }

    var fat: Double {
        guard let food else { return 0 }
        return food.fat * quantity
    }
}
