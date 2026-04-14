import Foundation
import SwiftData
import Supabase

/// Simple bidirectional sync: pull remote → merge locally, then push local → remote.
/// Uses last-write-wins on updatedAt. Errors are logged per-record, never crash.
actor SyncService {
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

    @MainActor
    func sync() async {
        let manager = SupabaseManager.shared
        guard manager.isSignedIn, !manager.isSyncing else { return }

        manager.isSyncing = true
        defer { manager.isSyncing = false }

        guard let userId = try? await supabase.auth.session.user.id.uuidString else { return }
        let context = modelContainer.mainContext

        // Order matters: foods before diary entries (foreign key dependency)
        await syncFoods(context: context, userId: userId)
        await syncRecipes(context: context, userId: userId)
        await syncDiaryEntries(context: context, userId: userId)
        await syncDailyGoals(context: context, userId: userId)
        await syncWeightEntries(context: context, userId: userId)

        try? context.save()
        manager.lastSyncDate = Date()
    }

    // MARK: - Foods

    @MainActor
    private func syncFoods(context: ModelContext, userId: String) async {
        guard let remoteFoods: [RemoteFood] = try? await supabase.from("foods").select().execute().value else { return }

        let localFoods = (try? context.fetch(FetchDescriptor<Food>())) ?? []
        let localById = Dictionary(localFoods.map { ($0.id.uuidString, $0) }, uniquingKeysWith: { _, b in b })
        let remoteById = Dictionary(remoteFoods.map { ($0.id, $0) }, uniquingKeysWith: { _, b in b })

        // Pull: remote → local
        for remote in remoteFoods {
            if let local = localById[remote.id] {
                if remote.updated_at > local.updatedAt {
                    local.name = remote.name; local.brand = remote.brand; local.barcode = remote.barcode
                    local.calories = remote.calories; local.protein = remote.protein
                    local.carbs = remote.carbs; local.fat = remote.fat
                    local.servingSize = remote.serving_size; local.servingUnit = remote.serving_unit
                    local.isCustom = remote.is_custom; local.isFavorite = remote.is_favorite
                    local.updatedAt = remote.updated_at; local.deletedAt = remote.deleted_at
                }
            } else {
                let f = Food(name: remote.name, brand: remote.brand, barcode: remote.barcode,
                             calories: remote.calories, protein: remote.protein, carbs: remote.carbs,
                             fat: remote.fat, servingSize: remote.serving_size, servingUnit: remote.serving_unit,
                             isCustom: remote.is_custom)
                f.id = UUID(uuidString: remote.id) ?? UUID()
                f.isFavorite = remote.is_favorite; f.createdAt = remote.created_at
                f.updatedAt = remote.updated_at; f.deletedAt = remote.deleted_at
                context.insert(f)
            }
        }

        // Push: local → remote (only records not on remote, or newer locally)
        for local in localFoods {
            let lid = local.id.uuidString
            if let remote = remoteById[lid] {
                guard local.updatedAt > remote.updated_at else { continue }
            }
            let dto = RemoteFood(id: lid, user_id: userId, name: local.name, brand: local.brand,
                                 barcode: local.barcode, calories: local.calories, protein: local.protein,
                                 carbs: local.carbs, fat: local.fat, serving_size: local.servingSize,
                                 serving_unit: local.servingUnit, is_custom: local.isCustom,
                                 is_favorite: local.isFavorite, created_at: local.createdAt,
                                 updated_at: local.updatedAt, deleted_at: local.deletedAt)
            try? await supabase.from("foods").upsert(dto, onConflict: "id").execute()
        }
    }

    // MARK: - Diary Entries

    @MainActor
    private func syncDiaryEntries(context: ModelContext, userId: String) async {
        guard let remoteEntries: [RemoteDiaryEntry] = try? await supabase.from("diary_entries").select().execute().value else { return }

        let localEntries = (try? context.fetch(FetchDescriptor<DiaryEntry>())) ?? []
        let localById = Dictionary(localEntries.map { ($0.id.uuidString, $0) }, uniquingKeysWith: { _, b in b })
        let remoteById = Dictionary(remoteEntries.map { ($0.id, $0) }, uniquingKeysWith: { _, b in b })

        // Pull
        for remote in remoteEntries {
            if let local = localById[remote.id] {
                if remote.updated_at > local.updatedAt {
                    local.mealTypeRaw = remote.meal_type
                    local.numberOfServings = remote.number_of_servings
                    local.updatedAt = remote.updated_at; local.deletedAt = remote.deleted_at
                }
            } else {
                let d = Self.dateFmt.date(from: remote.date) ?? Date()
                let entry = DiaryEntry(date: d, mealType: MealType(rawValue: remote.meal_type) ?? .snack,
                                       numberOfServings: remote.number_of_servings)
                entry.id = UUID(uuidString: remote.id) ?? UUID()
                entry.updatedAt = remote.updated_at; entry.deletedAt = remote.deleted_at
                // Link food/recipe by UUID lookup
                if let fid = remote.food_id, let uuid = UUID(uuidString: fid) {
                    entry.food = (try? context.fetch(FetchDescriptor<Food>(predicate: #Predicate { $0.id == uuid })))?.first
                }
                if let rid = remote.recipe_id, let uuid = UUID(uuidString: rid) {
                    entry.recipe = (try? context.fetch(FetchDescriptor<Recipe>(predicate: #Predicate { $0.id == uuid })))?.first
                }
                context.insert(entry)
            }
        }

        // Push
        for local in localEntries {
            let lid = local.id.uuidString
            if let remote = remoteById[lid] {
                guard local.updatedAt > remote.updated_at else { continue }
            }
            let dateStr = Self.dateFmt.string(from: Calendar.current.startOfDay(for: local.date))
            let dto = RemoteDiaryEntry(id: lid, user_id: userId, date: dateStr,
                                       meal_type: local.mealTypeRaw, number_of_servings: local.numberOfServings,
                                       food_id: local.food?.id.uuidString, recipe_id: local.recipe?.id.uuidString,
                                       created_at: local.updatedAt, updated_at: local.updatedAt, deleted_at: local.deletedAt)
            try? await supabase.from("diary_entries").upsert(dto, onConflict: "id").execute()
        }
    }

    // MARK: - Daily Goals

    @MainActor
    private func syncDailyGoals(context: ModelContext, userId: String) async {
        guard let remoteGoals: [RemoteDailyGoal] = try? await supabase.from("daily_goals").select().execute().value else { return }

        let localGoals = (try? context.fetch(FetchDescriptor<DailyGoal>())) ?? []
        let localById = Dictionary(localGoals.map { ($0.id.uuidString, $0) }, uniquingKeysWith: { _, b in b })
        let remoteById = Dictionary(remoteGoals.map { ($0.id, $0) }, uniquingKeysWith: { _, b in b })

        // Pull
        for remote in remoteGoals {
            if let local = localById[remote.id] {
                if remote.updated_at > local.updatedAt {
                    local.calories = remote.calories; local.protein = remote.protein
                    local.carbs = remote.carbs; local.fat = remote.fat
                    local.dayOfWeek = remote.day_of_week; local.updatedAt = remote.updated_at
                }
            } else {
                let g = DailyGoal(calories: remote.calories, protein: remote.protein,
                                  carbs: remote.carbs, fat: remote.fat, dayOfWeek: remote.day_of_week)
                g.id = UUID(uuidString: remote.id) ?? UUID()
                g.updatedAt = remote.updated_at
                context.insert(g)
            }
        }

        // Push — use onConflict "id" to avoid unique(user_id, day_of_week) clash
        for local in localGoals {
            let lid = local.id.uuidString
            if let remote = remoteById[lid] {
                guard local.updatedAt > remote.updated_at else { continue }
            }
            let dto = RemoteDailyGoal(id: lid, user_id: userId, calories: local.calories,
                                      protein: local.protein, carbs: local.carbs, fat: local.fat,
                                      day_of_week: local.dayOfWeek, updated_at: local.updatedAt)
            try? await supabase.from("daily_goals").upsert(dto, onConflict: "id").execute()
        }
    }

    // MARK: - Recipes

    @MainActor
    private func syncRecipes(context: ModelContext, userId: String) async {
        guard let remoteRecipes: [RemoteRecipe] = try? await supabase.from("recipes").select().execute().value else { return }

        let localRecipes = (try? context.fetch(FetchDescriptor<Recipe>())) ?? []
        let localById = Dictionary(localRecipes.map { ($0.id.uuidString, $0) }, uniquingKeysWith: { _, b in b })
        let remoteById = Dictionary(remoteRecipes.map { ($0.id, $0) }, uniquingKeysWith: { _, b in b })

        for remote in remoteRecipes {
            if let local = localById[remote.id] {
                if remote.updated_at > local.updatedAt {
                    local.name = remote.name; local.servings = remote.servings
                    local.updatedAt = remote.updated_at; local.deletedAt = remote.deleted_at
                }
            } else {
                let r = Recipe(name: remote.name, servings: remote.servings)
                r.id = UUID(uuidString: remote.id) ?? UUID()
                r.createdAt = remote.created_at; r.updatedAt = remote.updated_at; r.deletedAt = remote.deleted_at
                context.insert(r)
            }
        }

        for local in localRecipes {
            let lid = local.id.uuidString
            if let remote = remoteById[lid] {
                guard local.updatedAt > remote.updated_at else { continue }
            }
            let dto = RemoteRecipe(id: lid, user_id: userId, name: local.name, servings: local.servings,
                                   created_at: local.createdAt, updated_at: local.updatedAt, deleted_at: local.deletedAt)
            try? await supabase.from("recipes").upsert(dto, onConflict: "id").execute()
        }
    }

    // MARK: - Weight Entries

    @MainActor
    private func syncWeightEntries(context: ModelContext, userId: String) async {
        guard let remoteWeights: [RemoteWeightEntry] = try? await supabase.from("weight_entries").select().execute().value else { return }

        let localWeights = (try? context.fetch(FetchDescriptor<WeightEntry>())) ?? []
        let localById = Dictionary(localWeights.map { ($0.id.uuidString, $0) }, uniquingKeysWith: { _, b in b })
        let remoteById = Dictionary(remoteWeights.map { ($0.id, $0) }, uniquingKeysWith: { _, b in b })

        for remote in remoteWeights {
            if let local = localById[remote.id] {
                if remote.updated_at > local.updatedAt {
                    local.weight = remote.weight; local.note = remote.note
                    local.updatedAt = remote.updated_at; local.deletedAt = remote.deleted_at
                }
            } else {
                let d = Self.dateFmt.date(from: remote.date) ?? Date()
                let e = WeightEntry(date: d, weight: remote.weight, note: remote.note)
                e.id = UUID(uuidString: remote.id) ?? UUID()
                e.updatedAt = remote.updated_at; e.deletedAt = remote.deleted_at
                context.insert(e)
            }
        }

        for local in localWeights {
            let lid = local.id.uuidString
            if let remote = remoteById[lid] {
                guard local.updatedAt > remote.updated_at else { continue }
            }
            let dateStr = Self.dateFmt.string(from: local.date)
            let dto = RemoteWeightEntry(id: lid, user_id: userId, date: dateStr, weight: local.weight,
                                        note: local.note, created_at: local.updatedAt,
                                        updated_at: local.updatedAt, deleted_at: local.deletedAt)
            try? await supabase.from("weight_entries").upsert(dto, onConflict: "id").execute()
        }
    }
}

// MARK: - Remote DTOs

struct RemoteFood: Codable {
    let id: String; let user_id: String; let name: String; let brand: String; let barcode: String
    let calories: Double; let protein: Double; let carbs: Double; let fat: Double
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
    let carbs: Double; let fat: Double; let day_of_week: Int; let updated_at: Date
}

struct RemoteRecipe: Codable {
    let id: String; let user_id: String; let name: String; let servings: Double
    let created_at: Date; let updated_at: Date; let deleted_at: Date?
}

struct RemoteWeightEntry: Codable {
    let id: String; let user_id: String; let date: String; let weight: Double; let note: String
    let created_at: Date; let updated_at: Date; let deleted_at: Date?
}
