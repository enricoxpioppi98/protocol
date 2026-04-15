import Foundation

actor USDAFoodService {
    static let shared = USDAFoodService()

    private let baseURL = "https://api.nal.usda.gov/fdc/v1"
    private let session: URLSession

    private init() {
        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = 10
        self.session = URLSession(configuration: config)
    }

    /// Uses a user-configured key if available, otherwise falls back to DEMO_KEY.
    /// DEMO_KEY is limited to 30 req/hour. A free key from api.data.gov gives 1000/hour.
    private var apiKey: String {
        let custom = UserDefaults.standard.string(forKey: "usda_api_key") ?? ""
        return custom.isEmpty ? "DEMO_KEY" : custom
    }

    /// Search USDA FoodData Central for branded products AND prepared/survey foods.
    /// Including "Survey (FNDDS)" picks up restaurant-style prepared meals.
    func searchProducts(query: String) async throws -> [FoodProduct] {
        guard !query.isEmpty else { return [] }

        let encoded = query.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? query
        let dataTypes = "Branded,Survey%20%28FNDDS%29"
        let urlString = "\(baseURL)/foods/search?query=\(encoded)&pageSize=25&dataType=\(dataTypes)&api_key=\(apiKey)"

        guard let url = URL(string: urlString) else { return [] }

        let (data, _) = try await session.data(from: url)
        let json = try JSONSerialization.jsonObject(with: data) as? [String: Any]
        let foods = json?["foods"] as? [[String: Any]] ?? []
        return foods.compactMap { parseUSDAFood($0) }
    }

    private func parseUSDAFood(_ raw: [String: Any]) -> FoodProduct? {
        let description = raw["description"] as? String ?? ""
        guard !description.isEmpty else { return nil }

        // USDA branded names are often ALL CAPS — title-case them
        let name = description.localizedCapitalized

        let brandOwner = raw["brandOwner"] as? String
            ?? raw["brandName"] as? String
            ?? ""

        let dataType = raw["dataType"] as? String ?? ""
        let nutrients = raw["foodNutrients"] as? [[String: Any]] ?? []

        func nutrientValue(_ nutrientId: Int) -> Double {
            for n in nutrients {
                if let nid = n["nutrientId"] as? Int, nid == nutrientId {
                    if let val = n["value"] as? Double { return val }
                    if let val = n["value"] as? Int { return Double(val) }
                }
            }
            return 0
        }

        // USDA Branded nutrients are per 100g — scale to per-serving.
        // Survey (FNDDS) nutrients are already per 100g but usually no serving size,
        // so we default to 100g as one serving.
        let servingSizeVal = raw["servingSize"] as? Double
        let scaleFactor: Double
        if let val = servingSizeVal, val > 0 {
            scaleFactor = val / 100.0
        } else {
            scaleFactor = 1.0
        }

        let calories = nutrientValue(1008) * scaleFactor  // Energy (kcal)
        let protein  = nutrientValue(1003) * scaleFactor   // Protein
        let carbs    = nutrientValue(1005) * scaleFactor   // Carbohydrate, by difference
        let fat      = nutrientValue(1004) * scaleFactor   // Total lipid (fat)
        let fiber    = nutrientValue(1079) * scaleFactor   // Fiber, total dietary

        // Build serving size string
        let servingSizeUnit = raw["servingSizeUnit"] as? String ?? "g"
        let householdServing = raw["householdServingFullText"] as? String

        let servingString: String
        if let val = servingSizeVal {
            let base = "\(Int(val))\(servingSizeUnit.lowercased())"
            if let household = householdServing, !household.isEmpty {
                servingString = "\(base) (\(household))"
            } else {
                servingString = base
            }
        } else if let household = householdServing, !household.isEmpty {
            servingString = household
        } else {
            servingString = "100g"
        }

        // Provide a more useful brand for Survey foods
        let brand: String
        if !brandOwner.isEmpty {
            brand = brandOwner
        } else if dataType == "Survey (FNDDS)" {
            brand = "USDA Survey"
        } else {
            brand = ""
        }

        // gtinUpc field provides the barcode for branded products
        let barcode = raw["gtinUpc"] as? String ?? ""

        return FoodProduct(
            name: name,
            brand: brand,
            barcode: barcode,
            calories: calories,
            protein: protein,
            carbs: carbs,
            fat: fat,
            fiber: fiber,
            servingSize: servingString,
            source: .usda
        )
    }
}
