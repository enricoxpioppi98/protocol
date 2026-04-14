import Foundation
import SwiftData
import Supabase

/// Handles bidirectional sync between local SwiftData and Supabase.
/// Strategy: last-write-wins based on updatedAt timestamps.
actor SyncService {
    private let supabase: SupabaseClient
    private let modelContainer: ModelContainer

    private static let dateFormatter: DateFormatter = {
        let f = DateFormatter()
        f.dateFormat = "yyyy-MM-dd"
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = TimeZone(identifier: "UTC")
        return f
    }()

    init(supabase: SupabaseClient, modelContainer: ModelContainer) {
        self.supabase = supabase
        self.modelContainer = modelContainer
    }

    @MainActor
    func sync() async throws {
        let manager = SupabaseManager.shared
        guard manager.isSignedIn else { return }

        manager.isSyncing = true
        defer { Task { @MainActor in manager.isSyncing = false } }

        let context = modelContainer.mainContext
        let userId = try await supabase.auth.session.user.id.uuidString

        // Sync each table — continue even if one fails
        do { try await syncFoods(context: context, userId: userId) } catch { print("Sync foods error: \(error)") }
        do { try await syncDiaryEntries(context: context, userId: userId) } catch { print("Sync diary error: \(error)") }
        do { try await syncDailyGoals(context: context, userId: userId) } catch { print("Sync goals error: \(error)") }
        do { try await syncRecipes(context: context, userId: userId) } catch { print("Sync recipes error: \(error)") }
        do { try await syncWeightEntries(context: context, userId: userId) } catch { print("Sync weights error: \(error)") }

        try? context.save()

        await MainActor.run {
            SupabaseManager.shared.lastSyncDate = Date()
        }
    }

    // MARK: - Foods

    @MainActor
    private func syncFoods(context: ModelContext, userId: String) async throws {
        let remoteFoods: [RemoteFood] = try await supabase
            .from("foods")
            .select()
            .execute()
            .value

        let descriptor = FetchDescriptor<Food>()
        let localFoods = try context.fetch(descriptor)
        let localById = Dictionary(uniqueKeysWithValues: localFoods.map { ($0.id.uuidString, $0) })

        for remote in remoteFoods {
            if let local = localById[remote.id] {
                if remote.updated_at > local.updatedAt {
                    local.name = remote.name
                    local.brand = remote.brand
                    local.barcode = remote.barcode
                    local.calories = remote.calories
                    local.protein = remote.protein
                    local.carbs = remote.carbs
                    local.fat = remote.fat
                    local.servingSize = remote.serving_size
                    local.servingUnit = remote.serving_unit
                    local.isCustom = remote.is_custom
                    local.isFavorite = remote.is_favorite
                    local.updatedAt = remote.updated_at
                    local.deletedAt = remote.deleted_at
                }
            } else {
                let food = Food(name: remote.name, brand: remote.brand, barcode: remote.barcode,
                                calories: remote.calories, protein: remote.protein, carbs: remote.carbs,
                                fat: remote.fat, servingSize: remote.serving_size, servingUnit: remote.serving_unit,
                                isCustom: remote.is_custom)
                food.id = UUID(uuidString: remote.id) ?? UUID()
                food.isFavorite = remote.is_favorite
                food.createdAt = remote.created_at
                food.updatedAt = remote.updated_at
                food.deletedAt = remote.deleted_at
                context.insert(food)
            }
        }

        let remoteIds = Set(remoteFoods.map(\.id))
        for local in localFoods {
            let localId = local.id.uuidString
            let shouldPush = !remoteIds.contains(localId) ||
                (remoteFoods.first(where: { $0.id == localId }).map { local.updatedAt > $0.updated_at } ?? false)

            if shouldPush {
                try await supabase.from("foods").upsert(RemoteFood(
                    id: localId, user_id: userId, name: local.name, brand: local.brand,
                    barcode: local.barcode, calories: local.calories, protein: local.protein,
                    carbs: local.carbs, fat: local.fat, serving_size: local.servingSize,
                    serving_unit: local.servingUnit, is_custom: local.isCustom, is_favorite: local.isFavorite,
                    created_at: local.createdAt, updated_at: local.updatedAt, deleted_at: local.deletedAt
                )).execute()
            }
        }
    }

    // MARK: - Diary Entries

    @MainActor
    private func syncDiaryEntries(context: ModelContext, userId: String) async throws {
        let remoteEntries: [RemoteDiaryEntry] = try await supabase
            .from("diary_entries")
            .select()
            .execute()
            .value

        let descriptor = FetchDescriptor<DiaryEntry>()
        let localEntries = try context.fetch(descriptor)
        let localById = Dictionary(uniqueKeysWithValues: localEntries.map { ($0.id.uuidString, $0) })

        for remote in remoteEntries {
            if let local = localById[remote.id] {
                if remote.updated_at > local.updatedAt {
                    local.mealTypeRaw = remote.meal_type
                    local.numberOfServings = remote.number_of_servings
                    local.updatedAt = remote.updated_at
                    local.deletedAt = remote.deleted_at
                }
            } else {
                let parsedDate = Self.dateFormatter.date(from: remote.date) ?? Date()
                let entry = DiaryEntry(date: parsedDate, mealType: MealType(rawValue: remote.meal_type) ?? .snack,
                                       numberOfServings: remote.number_of_servings)
                entry.id = UUID(uuidString: remote.id) ?? UUID()
                entry.updatedAt = remote.updated_at
                entry.deletedAt = remote.deleted_at

                if let foodId = remote.food_id,
                   let foodUUID = UUID(uuidString: foodId) {
                    let foodDescriptor = FetchDescriptor<Food>(predicate: #Predicate { $0.id == foodUUID })
                    entry.food = try? context.fetch(foodDescriptor).first
                }
                if let recipeId = remote.recipe_id,
                   let recipeUUID = UUID(uuidString: recipeId) {
                    let recipeDescriptor = FetchDescriptor<Recipe>(predicate: #Predicate { $0.id == recipeUUID })
                    entry.recipe = try? context.fetch(recipeDescriptor).first
                }
                context.insert(entry)
            }
        }

        let remoteIds = Set(remoteEntries.map(\.id))
        for local in localEntries {
            let localId = local.id.uuidString
            let shouldPush = !remoteIds.contains(localId) ||
                (remoteEntries.first(where: { $0.id == localId }).map { local.updatedAt > $0.updated_at } ?? false)

            if shouldPush {
                let dateStr = Self.dateFormatter.string(from: Calendar.current.startOfDay(for: local.date))
                try await supabase.from("diary_entries").upsert(RemoteDiaryEntry(
                    id: localId, user_id: userId, date: dateStr,
                    meal_type: local.mealTypeRaw, number_of_servings: local.numberOfServings,
                    food_id: local.food?.id.uuidString, recipe_id: local.recipe?.id.uuidString,
                    created_at: local.updatedAt, updated_at: local.updatedAt, deleted_at: local.deletedAt
                )).execute()
            }
        }
    }

    // MARK: - Daily Goals

    @MainActor
    private func syncDailyGoals(context: ModelContext, userId: String) async throws {
        let remoteGoals: [RemoteDailyGoal] = try await supabase
            .from("daily_goals")
            .select()
            .execute()
            .value

        let descriptor = FetchDescriptor<DailyGoal>()
        let localGoals = try context.fetch(descriptor)
        let localById = Dictionary(uniqueKeysWithValues: localGoals.map { ($0.id.uuidString, $0) })

        for remote in remoteGoals {
            if let local = localById[remote.id] {
                if remote.updated_at > local.updatedAt {
                    local.calories = remote.calories
                    local.protein = remote.protein
                    local.carbs = remote.carbs
                    local.fat = remote.fat
                    local.dayOfWeek = remote.day_of_week
                    local.updatedAt = remote.updated_at
                }
            } else {
                let goal = DailyGoal(calories: remote.calories, protein: remote.protein,
                                     carbs: remote.carbs, fat: remote.fat, dayOfWeek: remote.day_of_week)
                goal.id = UUID(uuidString: remote.id) ?? UUID()
                goal.updatedAt = remote.updated_at
                context.insert(goal)
            }
        }

        let remoteIds = Set(remoteGoals.map(\.id))
        for local in localGoals {
            let localId = local.id.uuidString
            let shouldPush = !remoteIds.contains(localId) ||
                (remoteGoals.first(where: { $0.id == localId }).map { local.updatedAt > $0.updated_at } ?? false)

            if shouldPush {
                try await supabase.from("daily_goals").upsert(RemoteDailyGoal(
                    id: localId, user_id: userId, calories: local.calories, protein: local.protein,
                    carbs: local.carbs, fat: local.fat, day_of_week: local.dayOfWeek, updated_at: local.updatedAt
                )).execute()
            }
        }
    }

    // MARK: - Recipes

    @MainActor
    private func syncRecipes(context: ModelContext, userId: String) async throws {
        let remoteRecipes: [RemoteRecipe] = try await supabase
            .from("recipes")
            .select()
            .execute()
            .value

        let descriptor = FetchDescriptor<Recipe>()
        let localRecipes = try context.fetch(descriptor)
        let localById = Dictionary(uniqueKeysWithValues: localRecipes.map { ($0.id.uuidString, $0) })

        for remote in remoteRecipes {
            if let local = localById[remote.id] {
                if remote.updated_at > local.updatedAt {
                    local.name = remote.name
                    local.servings = remote.servings
                    local.updatedAt = remote.updated_at
                    local.deletedAt = remote.deleted_at
                }
            } else {
                let recipe = Recipe(name: remote.name, servings: remote.servings)
                recipe.id = UUID(uuidString: remote.id) ?? UUID()
                recipe.createdAt = remote.created_at
                recipe.updatedAt = remote.updated_at
                recipe.deletedAt = remote.deleted_at
                context.insert(recipe)
            }
        }

        let remoteIds = Set(remoteRecipes.map(\.id))
        for local in localRecipes {
            let localId = local.id.uuidString
            let shouldPush = !remoteIds.contains(localId) ||
                (remoteRecipes.first(where: { $0.id == localId }).map { local.updatedAt > $0.updated_at } ?? false)

            if shouldPush {
                try await supabase.from("recipes").upsert(RemoteRecipe(
                    id: localId, user_id: userId, name: local.name, servings: local.servings,
                    created_at: local.createdAt, updated_at: local.updatedAt, deleted_at: local.deletedAt
                )).execute()
            }
        }
    }

    // MARK: - Weight Entries

    @MainActor
    private func syncWeightEntries(context: ModelContext, userId: String) async throws {
        let remoteWeights: [RemoteWeightEntry] = try await supabase
            .from("weight_entries")
            .select()
            .execute()
            .value

        let descriptor = FetchDescriptor<WeightEntry>()
        let localWeights = try context.fetch(descriptor)
        let localById = Dictionary(uniqueKeysWithValues: localWeights.map { ($0.id.uuidString, $0) })

        for remote in remoteWeights {
            if let local = localById[remote.id] {
                if remote.updated_at > local.updatedAt {
                    local.weight = remote.weight
                    local.note = remote.note
                    local.updatedAt = remote.updated_at
                    local.deletedAt = remote.deleted_at
                }
            } else {
                let parsedDate = Self.dateFormatter.date(from: remote.date) ?? Date()
                let entry = WeightEntry(date: parsedDate, weight: remote.weight, note: remote.note)
                entry.id = UUID(uuidString: remote.id) ?? UUID()
                entry.updatedAt = remote.updated_at
                entry.deletedAt = remote.deleted_at
                context.insert(entry)
            }
        }

        let remoteIds = Set(remoteWeights.map(\.id))
        for local in localWeights {
            let localId = local.id.uuidString
            let shouldPush = !remoteIds.contains(localId) ||
                (remoteWeights.first(where: { $0.id == localId }).map { local.updatedAt > $0.updated_at } ?? false)

            if shouldPush {
                let dateStr = Self.dateFormatter.string(from: local.date)
                try await supabase.from("weight_entries").upsert(RemoteWeightEntry(
                    id: localId, user_id: userId, date: dateStr, weight: local.weight,
                    note: local.note, created_at: local.updatedAt, updated_at: local.updatedAt, deleted_at: local.deletedAt
                )).execute()
            }
        }
    }
}

// MARK: - Remote DTOs (match Supabase table columns)
// Note: `date` columns (PostgreSQL date type) are String ("YYYY-MM-DD"), not Date.
// `timestamptz` columns (created_at, updated_at, deleted_at) are Date.

struct RemoteFood: Codable {
    let id: String
    let user_id: String
    let name: String
    let brand: String
    let barcode: String
    let calories: Double
    let protein: Double
    let carbs: Double
    let fat: Double
    let serving_size: Double
    let serving_unit: String
    let is_custom: Bool
    let is_favorite: Bool
    let created_at: Date
    let updated_at: Date
    let deleted_at: Date?
}

struct RemoteDiaryEntry: Codable {
    let id: String
    let user_id: String
    let date: String          // PostgreSQL date type → "YYYY-MM-DD"
    let meal_type: String
    let number_of_servings: Double
    let food_id: String?
    let recipe_id: String?
    let created_at: Date
    let updated_at: Date
    let deleted_at: Date?
}

struct RemoteDailyGoal: Codable {
    let id: String
    let user_id: String
    let calories: Double
    let protein: Double
    let carbs: Double
    let fat: Double
    let day_of_week: Int
    let updated_at: Date
}

struct RemoteRecipe: Codable {
    let id: String
    let user_id: String
    let name: String
    let servings: Double
    let created_at: Date
    let updated_at: Date
    let deleted_at: Date?
}

struct RemoteWeightEntry: Codable {
    let id: String
    let user_id: String
    let date: String          // PostgreSQL date type → "YYYY-MM-DD"
    let weight: Double
    let note: String
    let created_at: Date
    let updated_at: Date
    let deleted_at: Date?
}
