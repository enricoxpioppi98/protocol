import Foundation

actor USDAFoodService {
    static let shared = USDAFoodService()

    private let baseURL = "https://api.nal.usda.gov/fdc/v1"
    private let apiKey = "DEMO_KEY"
    private let session: URLSession

    private init() {
        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = 10
        self.session = URLSession(configuration: config)
    }

    /// Search USDA FoodData Central for branded food products.
    func searchProducts(query: String) async throws -> [FoodProduct] {
        guard !query.isEmpty else { return [] }

        let encoded = query.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? query
        let urlString = "\(baseURL)/foods/search?query=\(encoded)&pageSize=25&dataType=Branded&api_key=\(apiKey)"

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

        // USDA Branded nutrients are per 100g — scale to per-serving
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

        // gtinUpc field provides the barcode for branded products
        let barcode = raw["gtinUpc"] as? String ?? ""

        return FoodProduct(
            name: name,
            brand: brandOwner,
            barcode: barcode,
            calories: calories,
            protein: protein,
            carbs: carbs,
            fat: fat,
            servingSize: servingString,
            source: .usda
        )
    }
}
