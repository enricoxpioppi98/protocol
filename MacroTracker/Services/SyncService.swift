import Foundation
import SwiftData
import Supabase

/// Bidirectional sync between local SwiftData and Supabase.
@MainActor
final class SyncService {
    private let supabase: SupabaseClient
    private let modelContainer: ModelContainer

    private static let dateFmt: DateFormatter = {
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

    func sync() async {
        let manager = SupabaseManager.shared
        guard manager.isSignedIn, !manager.isSyncing else {
            print("[Sync] Skipped: signed_in=\(manager.isSignedIn) syncing=\(manager.isSyncing)")
            return
        }

        manager.isSyncing = true
        defer { manager.isSyncing = false }

        guard let userId = try? await supabase.auth.session.user.id.uuidString else {
            print("[Sync] Failed to get user session")
            return
        }
        print("[Sync] Starting sync for user \(userId)")

        let context = modelContainer.mainContext

        // Order: foods & recipes first (diary entries reference them)
        await pullFoods(context, userId); await pushFoods(context, userId)
        await pullRecipes(context, userId); await pushRecipes(context, userId)
        await pullDiaryEntries(context, userId); await pushDiaryEntries(context, userId)
        await pullDailyGoals(context, userId); await pushDailyGoals(context, userId)
        await pullWeightEntries(context, userId); await pushWeightEntries(context, userId)

        do {
            try context.save()
            print("[Sync] Context saved successfully")
        } catch {
            print("[Sync] Context save error: \(error)")
        }

        manager.lastSyncDate = Date()
        print("[Sync] Complete")
    }

    // MARK: - Foods

    private func pullFoods(_ context: ModelContext, _ userId: String) async {
        do {
            let remote: [RemoteFood] = try await supabase.from("foods").select().execute().value
            print("[Sync] Pulled \(remote.count) remote foods")

            let local = (try? context.fetch(FetchDescriptor<Food>())) ?? []
            let localById = Dictionary(local.map { ($0.id.uuidString, $0) }, uniquingKeysWith: { _, b in b })

            for r in remote {
                if let l = localById[r.id] {
                    if r.updated_at > l.updatedAt {
                        l.name = r.name; l.brand = r.brand; l.barcode = r.barcode
                        l.calories = r.calories; l.protein = r.protein; l.carbs = r.carbs; l.fat = r.fat; l.fiber = r.fiber
                        l.servingSize = r.serving_size; l.servingUnit = r.serving_unit
                        l.isCustom = r.is_custom; l.isFavorite = r.is_favorite
                        l.updatedAt = r.updated_at; l.deletedAt = r.deleted_at
                    }
                } else {
                    let f = Food(name: r.name, brand: r.brand, barcode: r.barcode,
                                 calories: r.calories, protein: r.protein, carbs: r.carbs,
                                 fat: r.fat, fiber: r.fiber, servingSize: r.serving_size, servingUnit: r.serving_unit,
                                 isCustom: r.is_custom)
                    f.id = UUID(uuidString: r.id) ?? UUID()
                    f.isFavorite = r.is_favorite; f.createdAt = r.created_at
                    f.updatedAt = r.updated_at; f.deletedAt = r.deleted_at
                    context.insert(f)
                }
            }
        } catch {
            print("[Sync] Pull foods FAILED: \(error)")
        }
    }

    private func pushFoods(_ context: ModelContext, _ userId: String) async {
        let local = (try? context.fetch(FetchDescriptor<Food>())) ?? []
        for l in local {
            let dto = RemoteFood(id: l.id.uuidString, user_id: userId, name: l.name, brand: l.brand,
                                 barcode: l.barcode, calories: l.calories, protein: l.protein,
                                 carbs: l.carbs, fat: l.fat, fiber: l.fiber, serving_size: l.servingSize,
                                 serving_unit: l.servingUnit, is_custom: l.isCustom,
                                 is_favorite: l.isFavorite, created_at: l.createdAt,
                                 updated_at: l.updatedAt, deleted_at: l.deletedAt)
            do {
                try await supabase.from("foods").upsert(dto, onConflict: "id").execute()
            } catch {
                print("[Sync] Push food '\(l.name)' FAILED: \(error)")
            }
        }
        print("[Sync] Pushed \(local.count) foods")
    }

    // MARK: - Diary Entries

    private func pullDiaryEntries(_ context: ModelContext, _ userId: String) async {
        do {
            let remote: [RemoteDiaryEntry] = try await supabase.from("diary_entries").select().execute().value
            print("[Sync] Pulled \(remote.count) remote diary entries")

            let local = (try? context.fetch(FetchDescriptor<DiaryEntry>())) ?? []
            let localById = Dictionary(local.map { ($0.id.uuidString, $0) }, uniquingKeysWith: { _, b in b })

            for r in remote {
                if let l = localById[r.id] {
                    if r.updated_at > l.updatedAt {
                        l.mealTypeRaw = r.meal_type; l.numberOfServings = r.number_of_servings
                        l.updatedAt = r.updated_at; l.deletedAt = r.deleted_at
                    }
                } else {
                    let date = Self.dateFmt.date(from: r.date) ?? Date()
                    let entry = DiaryEntry(date: date, mealType: MealType(rawValue: r.meal_type) ?? .snack,
                                           numberOfServings: r.number_of_servings)
                    entry.id = UUID(uuidString: r.id) ?? UUID()
                    entry.updatedAt = r.updated_at; entry.deletedAt = r.deleted_at
                    if let fid = r.food_id, let uuid = UUID(uuidString: fid) {
                        entry.food = (try? context.fetch(FetchDescriptor<Food>(predicate: #Predicate { $0.id == uuid })))?.first
                    }
                    if let rid = r.recipe_id, let uuid = UUID(uuidString: rid) {
                        entry.recipe = (try? context.fetch(FetchDescriptor<Recipe>(predicate: #Predicate { $0.id == uuid })))?.first
                    }
                    context.insert(entry)
                }
            }
        } catch {
            print("[Sync] Pull diary entries FAILED: \(error)")
        }
    }

    private func pushDiaryEntries(_ context: ModelContext, _ userId: String) async {
        let local = (try? context.fetch(FetchDescriptor<DiaryEntry>())) ?? []
        for l in local {
            let dateStr = Self.dateFmt.string(from: Calendar.current.startOfDay(for: l.date))
            let dto = RemoteDiaryEntry(id: l.id.uuidString, user_id: userId, date: dateStr,
                                       meal_type: l.mealTypeRaw, number_of_servings: l.numberOfServings,
                                       food_id: l.food?.id.uuidString, recipe_id: l.recipe?.id.uuidString,
                                       created_at: l.updatedAt, updated_at: l.updatedAt, deleted_at: l.deletedAt)
            do {
                try await supabase.from("diary_entries").upsert(dto, onConflict: "id").execute()
            } catch {
                print("[Sync] Push diary entry FAILED: \(error)")
            }
        }
        print("[Sync] Pushed \(local.count) diary entries")
    }

    // MARK: - Daily Goals

    private func pullDailyGoals(_ context: ModelContext, _ userId: String) async {
        do {
            let remote: [RemoteDailyGoal] = try await supabase.from("daily_goals").select().execute().value
            print("[Sync] Pulled \(remote.count) remote goals")

            let local = (try? context.fetch(FetchDescriptor<DailyGoal>())) ?? []
            let localById = Dictionary(local.map { ($0.id.uuidString, $0) }, uniquingKeysWith: { _, b in b })

            for r in remote {
                if let l = localById[r.id] {
                    if r.updated_at > l.updatedAt {
                        l.calories = r.calories; l.protein = r.protein
                        l.carbs = r.carbs; l.fat = r.fat; l.fiber = r.fiber
                        l.dayOfWeek = r.day_of_week; l.updatedAt = r.updated_at
                    }
                } else {
                    let g = DailyGoal(calories: r.calories, protein: r.protein,
                                      carbs: r.carbs, fat: r.fat, fiber: r.fiber, dayOfWeek: r.day_of_week)
                    g.id = UUID(uuidString: r.id) ?? UUID()
                    g.updatedAt = r.updated_at
                    context.insert(g)
                }
            }
        } catch {
            print("[Sync] Pull goals FAILED: \(error)")
        }
    }

    private func pushDailyGoals(_ context: ModelContext, _ userId: String) async {
        let local = (try? context.fetch(FetchDescriptor<DailyGoal>())) ?? []
        for l in local {
            let dto = RemoteDailyGoal(id: l.id.uuidString, user_id: userId, calories: l.calories,
                                      protein: l.protein, carbs: l.carbs, fat: l.fat,
                                      fiber: l.fiber, day_of_week: l.dayOfWeek, updated_at: l.updatedAt)
            do {
                try await supabase.from("daily_goals").upsert(dto, onConflict: "id").execute()
            } catch {
                print("[Sync] Push goal FAILED: \(error)")
            }
        }
        print("[Sync] Pushed \(local.count) goals")
    }

    // MARK: - Recipes

    private func pullRecipes(_ context: ModelContext, _ userId: String) async {
        do {
            let remote: [RemoteRecipe] = try await supabase.from("recipes").select().execute().value
            print("[Sync] Pulled \(remote.count) remote recipes")

            let local = (try? context.fetch(FetchDescriptor<Recipe>())) ?? []
            let localById = Dictionary(local.map { ($0.id.uuidString, $0) }, uniquingKeysWith: { _, b in b })

            for r in remote {
                if let l = localById[r.id] {
                    if r.updated_at > l.updatedAt {
                        l.name = r.name; l.servings = r.servings
                        l.updatedAt = r.updated_at; l.deletedAt = r.deleted_at
                    }
                } else {
                    let recipe = Recipe(name: r.name, servings: r.servings)
                    recipe.id = UUID(uuidString: r.id) ?? UUID()
                    recipe.createdAt = r.created_at; recipe.updatedAt = r.updated_at; recipe.deletedAt = r.deleted_at
                    context.insert(recipe)
                }
            }
        } catch {
            print("[Sync] Pull recipes FAILED: \(error)")
        }
    }

    private func pushRecipes(_ context: ModelContext, _ userId: String) async {
        let local = (try? context.fetch(FetchDescriptor<Recipe>())) ?? []
        for l in local {
            let dto = RemoteRecipe(id: l.id.uuidString, user_id: userId, name: l.name, servings: l.servings,
                                   created_at: l.createdAt, updated_at: l.updatedAt, deleted_at: l.deletedAt)
            do {
                try await supabase.from("recipes").upsert(dto, onConflict: "id").execute()
            } catch {
                print("[Sync] Push recipe '\(l.name)' FAILED: \(error)")
            }
        }
        print("[Sync] Pushed \(local.count) recipes")
    }

    // MARK: - Weight Entries

    private func pullWeightEntries(_ context: ModelContext, _ userId: String) async {
        do {
            let remote: [RemoteWeightEntry] = try await supabase.from("weight_entries").select().execute().value
            print("[Sync] Pulled \(remote.count) remote weight entries")

            let local = (try? context.fetch(FetchDescriptor<WeightEntry>())) ?? []
            let localById = Dictionary(local.map { ($0.id.uuidString, $0) }, uniquingKeysWith: { _, b in b })

            for r in remote {
                if let l = localById[r.id] {
                    if r.updated_at > l.updatedAt {
                        l.weight = r.weight; l.note = r.note
                        l.updatedAt = r.updated_at; l.deletedAt = r.deleted_at
                    }
                } else {
                    let date = Self.dateFmt.date(from: r.date) ?? Date()
                    let e = WeightEntry(date: date, weight: r.weight, note: r.note)
                    e.id = UUID(uuidString: r.id) ?? UUID()
                    e.updatedAt = r.updated_at; e.deletedAt = r.deleted_at
                    context.insert(e)
                }
            }
        } catch {
            print("[Sync] Pull weight entries FAILED: \(error)")
        }
    }

    private func pushWeightEntries(_ context: ModelContext, _ userId: String) async {
        let local = (try? context.fetch(FetchDescriptor<WeightEntry>())) ?? []
        for l in local {
            let dateStr = Self.dateFmt.string(from: l.date)
            let dto = RemoteWeightEntry(id: l.id.uuidString, user_id: userId, date: dateStr,
                                        weight: l.weight, note: l.note,
                                        created_at: l.updatedAt, updated_at: l.updatedAt, deleted_at: l.deletedAt)
            do {
                try await supabase.from("weight_entries").upsert(dto, onConflict: "id").execute()
            } catch {
                print("[Sync] Push weight entry FAILED: \(error)")
            }
        }
        print("[Sync] Pushed \(local.count) weight entries")
    }
}

// MARK: - Remote DTOs

struct RemoteFood: Codable {
    let id: String; let user_id: String; let name: String; let brand: String; let barcode: String
    let calories: Double; let protein: Double; let carbs: Double; let fat: Double; let fiber: Double
    let serving_size: Double; let serving_unit: String; let is_custom: Bool; let is_favorite: Bool
    let created_at: Date; let updated_at: Date; let deleted_at: Date?
}

struct RemoteDiaryEntry: Codable {
    let id: String; let user_id: String; let date: String; let meal_type: String
    let number_of_servings: Double; let food_id: String?; let recipe_id: String?
    let created_at: Date; let updated_at: Date; let deleted_at: Date?
}

struct RemoteDailyGoal: Codable {
    let id: String; let user_id: String; let calories: Double; let protein: Double
    let carbs: Double; let fat: Double; let fiber: Double; let day_of_week: Int; let updated_at: Date
}

struct RemoteRecipe: Codable {
    let id: String; let user_id: String; let name: String; let servings: Double
    let created_at: Date; let updated_at: Date; let deleted_at: Date?
}

struct RemoteWeightEntry: Codable {
    let id: String; let user_id: String; let date: String; let weight: Double; let note: String
    let created_at: Date; let updated_at: Date; let deleted_at: Date?
}
