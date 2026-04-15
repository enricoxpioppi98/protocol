import Foundation

enum FoodSource: String, Sendable {
    case openFoodFacts = "OpenFoodFacts"
    case usda = "USDA"
    case nutritionix = "Nutritionix"
}

struct FoodProduct: Identifiable, Sendable {
    let id = UUID()
    let name: String
    let brand: String
    let barcode: String
    let calories: Double
    let protein: Double
    let carbs: Double
    let fat: Double
    let fiber: Double
    let servingSize: String
    let source: FoodSource

    func toFood() -> Food {
        let size = parseServingSize()
        return Food(
            name: name,
            brand: brand,
            barcode: barcode,
            calories: calories,
            protein: protein,
            carbs: carbs,
            fat: fat,
            fiber: fiber,
            servingSize: size.0,
            servingUnit: size.1,
            isCustom: false
        )
    }

    private func parseServingSize() -> (Double, String) {
        let cleaned = servingSize.trimmingCharacters(in: .whitespaces)
        let pattern = /(\d+\.?\d*)\s*(\w+)/
        if let match = cleaned.firstMatch(of: pattern) {
            let value = Double(match.1) ?? 100
            let unit = String(match.2)
            return (value, unit)
        }
        return (100, "g")
    }
}

actor OpenFoodFactsService {
    static let shared = OpenFoodFactsService()

    private let baseURL = "https://world.openfoodfacts.org"
    private let session: URLSession

    private init() {
        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = 10
        self.session = URLSession(configuration: config)
    }

    func searchProducts(query: String) async throws -> [FoodProduct] {
        guard !query.isEmpty else { return [] }

        let encoded = query.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? query
        let url = URL(string: "\(baseURL)/cgi/search.pl?search_terms=\(encoded)&search_simple=1&action=process&json=1&page_size=20")!

        let (data, _) = try await session.data(from: url)
        let json = try JSONSerialization.jsonObject(with: data) as? [String: Any]
        let products = json?["products"] as? [[String: Any]] ?? []
        return products.compactMap { parseProductJSON($0) }
    }

    func lookupBarcode(_ barcode: String) async throws -> FoodProduct? {
        let url = URL(string: "\(baseURL)/api/v0/product/\(barcode).json")!

        let (data, _) = try await session.data(from: url)
        let json = try JSONSerialization.jsonObject(with: data) as? [String: Any]

        guard let status = json?["status"] as? Int, status == 1,
              let product = json?["product"] as? [String: Any] else {
            return nil
        }
        return parseProductJSON(product)
    }

    private func parseProductJSON(_ raw: [String: Any]) -> FoodProduct? {
        let name = raw["product_name"] as? String ?? ""
        guard !name.isEmpty else { return nil }

        let nutriments = raw["nutriments"] as? [String: Any] ?? [:]
        let servingSize = raw["serving_size"] as? String ?? "100g"

        func nutrient(_ key: String) -> Double {
            if let val = nutriments[key] as? Double { return val }
            if let val = nutriments[key] as? Int { return Double(val) }
            if let val = nutriments[key] as? String { return Double(val) ?? 0 }
            return 0
        }

        // Prefer per-serving values, fall back to per-100g
        let calories = nutrient("energy-kcal_serving").nonZeroOr { nutrient("energy-kcal_100g") }
        let protein = nutrient("proteins_serving").nonZeroOr { nutrient("proteins_100g") }
        let carbs = nutrient("carbohydrates_serving").nonZeroOr { nutrient("carbohydrates_100g") }
        let fat = nutrient("fat_serving").nonZeroOr { nutrient("fat_100g") }
        let fiber = nutrient("fiber_serving").nonZeroOr { nutrient("fiber_100g") }

        return FoodProduct(
            name: name,
            brand: raw["brands"] as? String ?? "",
            barcode: raw["code"] as? String ?? raw["_id"] as? String ?? "",
            calories: calories,
            protein: protein,
            carbs: carbs,
            fat: fat,
            fiber: fiber,
            servingSize: servingSize,
            source: .openFoodFacts
        )
    }
}

private extension Double {
    func nonZeroOr(_ fallback: () -> Double) -> Double {
        self > 0 ? self : fallback()
    }
}
