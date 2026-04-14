import SwiftUI
import SwiftData

@main
struct MacroTrackerApp: App {
    let container: ModelContainer

    init() {
        let schema = Schema([
            Food.self,
            Recipe.self,
            RecipeIngredient.self,
            DiaryEntry.self,
            DailyGoal.self,
            WeightEntry.self,
            MealTemplate.self,
            MealTemplateItem.self,
        ])
        let config = ModelConfiguration(schema: schema)
        do {
            container = try ModelContainer(for: schema, configurations: [config])
        } catch {
            // Migration failed — delete corrupt store and start fresh
            let url = config.url
            try? FileManager.default.removeItem(at: url)
            let dir = url.deletingLastPathComponent()
            let base = url.lastPathComponent
            for suffix in ["-shm", "-wal"] {
                try? FileManager.default.removeItem(
                    at: dir.appendingPathComponent(base + suffix))
            }
            container = try! ModelContainer(for: schema, configurations: [config])
        }
    }

    var body: some Scene {
        WindowGroup {
            ContentView()
                .task {
                    // Check if user has an active Supabase session
                    await SupabaseManager.shared.checkSession()

                    // Auto-sync if signed in
                    if SupabaseManager.shared.isSignedIn {
                        let syncService = SyncService(
                            supabase: SupabaseManager.shared.client,
                            modelContainer: container
                        )
                        try? await syncService.sync()
                    }
                }
        }
        .modelContainer(container)
    }
}
