import SwiftUI
import SwiftData

@main
struct MacroTrackerApp: App {
    var body: some Scene {
        WindowGroup {
            ContentView()
        }
        .modelContainer(for: [
            Food.self,
            Recipe.self,
            RecipeIngredient.self,
            DiaryEntry.self,
            DailyGoal.self
        ])
    }
}
