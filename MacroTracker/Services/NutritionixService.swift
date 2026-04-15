import Foundation

/// Nutritionix API — best-in-class for restaurant and chain food data
/// (Chipotle, McDonald's, Starbucks, Subway, etc.)
///
/// Free API keys: https://developer.nutritionix.com/signup
actor NutritionixService {
    static let shared = NutritionixService()

    private let baseURL = "https://trackapi.nutritionix.com/v2"
    private let session: URLSession

    private init() {
        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = 10
        self.session = URLSession(configuration: config)
    }

    // MARK: - Configuration

    var appId: String {
        UserDefaults.standard.string(forKey: "nutritionix_app_id") ?? ""
    }

    var appKey: String {
        UserDefaults.standard.string(forKey: "nutritionix_app_key") ?? ""
    }

    var isConfigured: Bool {
        !appId.isEmpty && !appKey.isEmpty
    }

    // MARK: - Instant search (returns a list of matching branded items)

    func searchBranded(query: String) async throws -> [NutritionixBrandedResult] {
        guard isConfigured, !query.isEmpty else { return [] }

        let encoded = query.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? query
        let urlString = "\(baseURL)/search/instant?query=\(encoded)&branded=true&common=false&detailed=true"
        guard let url = URL(string: urlString) else { return [] }

        var request = URLRequest(url: url)
        request.setValue(appId, forHTTPHeaderField: "x-app-id")
        request.setValue(appKey, forHTTPHeaderField: "x-app-key")

        let (data, _) = try await session.data(for: request)
        let json = try JSONSerialization.jsonObject(with: data) as? [String: Any]
        let branded = json?["branded"] as? [[String: Any]] ?? []
        return branded.compactMap { parseBrandedResult($0) }
    }

    // MARK: - Item detail (full nutrition for a branded item)

    func getItemDetails(nixItemId: String) async throws -> FoodProduct? {
        guard isConfigured, !nixItemId.isEmpty else { return nil }

        let encoded = nixItemId.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? nixItemId
        let urlString = "\(baseURL)/search/item?nix_item_id=\(encoded)"
        guard let url = URL(string: urlString) else { return nil }

        var request = URLRequest(url: url)
        request.setValue(appId, forHTTPHeaderField: "x-app-id")
        request.setValue(appKey, forHTTPHeaderField: "x-app-key")

        let (data, _) = try await session.data(for: request)
        let json = try JSONSerialization.jsonObject(with: data) as? [String: Any]
        let foods = json?["foods"] as? [[String: Any]] ?? []
        guard let item = foods.first else { return nil }
        return parseFullItem(item)
    }

    // MARK: - Natural language (parse "chipotle chicken bowl" into nutrition)

    func naturalNutrients(query: String) async throws -> [FoodProduct] {
        guard isConfigured, !query.isEmpty else { return [] }

        let urlString = "\(baseURL)/natural/nutrients"
        guard let url = URL(string: urlString) else { return [] }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue(appId, forHTTPHeaderField: "x-app-id")
        request.setValue(appKey, forHTTPHeaderField: "x-app-key")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try? JSONSerialization.data(withJSONObject: ["query": query])

        let (data, _) = try await session.data(for: request)
        let json = try JSONSerialization.jsonObject(with: data) as? [String: Any]
        let foods = json?["foods"] as? [[String: Any]] ?? []
        return foods.compactMap { parseFullItem($0) }
    }

    // MARK: - Parsing

    private func parseBrandedResult(_ raw: [String: Any]) -> NutritionixBrandedResult? {
        let foodName = raw["food_name"] as? String ?? raw["brand_name_item_name"] as? String ?? ""
        guard !foodName.isEmpty else { return nil }

        return NutritionixBrandedResult(
            foodName: foodName.localizedCapitalized,
            brandName: (raw["brand_name"] as? String ?? "").localizedCapitalized,
            calories: raw["nf_calories"] as? Double ?? 0,
            nixItemId: raw["nix_item_id"] as? String ?? "",
            servingQty: raw["serving_qty"] as? Double ?? 1,
            servingUnit: raw["serving_unit"] as? String ?? "serving",
            photo: (raw["photo"] as? [String: Any])?["thumb"] as? String
        )
    }

    private func parseFullItem(_ raw: [String: Any]) -> FoodProduct? {
        let foodName = raw["food_name"] as? String ?? ""
        guard !foodName.isEmpty else { return nil }

        let brandName = raw["brand_name"] as? String ?? ""
        let calories = raw["nf_calories"] as? Double ?? 0
        let protein = raw["nf_protein"] as? Double ?? 0
        let carbs = raw["nf_total_carbohydrate"] as? Double ?? 0
        let fat = raw["nf_total_fat"] as? Double ?? 0
        let fiber = raw["nf_dietary_fiber"] as? Double ?? 0
        let servingQty = raw["serving_qty"] as? Double ?? 1
        let servingUnit = raw["serving_unit"] as? String ?? "serving"
        let servingWeightGrams = raw["serving_weight_grams"] as? Double

        var servingString = "\(formatQty(servingQty)) \(servingUnit)"
        if let grams = servingWeightGrams, grams > 0 {
            servingString += " (\(Int(grams))g)"
        }

        return FoodProduct(
            name: foodName.localizedCapitalized,
            brand: brandName.localizedCapitalized,
            barcode: raw["nix_item_id"] as? String ?? "",
            calories: calories,
            protein: protein,
            carbs: carbs,
            fat: fat,
            fiber: fiber,
            servingSize: servingString,
            source: .nutritionix
        )
    }

    private func formatQty(_ qty: Double) -> String {
        qty.truncatingRemainder(dividingBy: 1) == 0
            ? String(format: "%.0f", qty)
            : String(format: "%.1f", qty)
    }
}

// MARK: - Branded Search Result (lightweight, before full detail fetch)

struct NutritionixBrandedResult: Identifiable, Sendable {
    let id = UUID()
    let foodName: String
    let brandName: String
    let calories: Double
    let nixItemId: String
    let servingQty: Double
    let servingUnit: String
    let photo: String?
}
