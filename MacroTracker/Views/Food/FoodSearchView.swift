import SwiftUI
import SwiftData

struct FoodSearchView: View {
    @Environment(\.modelContext) private var modelContext
    @Environment(\.dismiss) private var dismiss

    let mealType: MealType
    let date: Date

    @State private var searchText = ""
    @State private var apiResults: [OpenFoodFactsProduct] = []
    @State private var isSearching = false
    @State private var searchTask: Task<Void, Never>?
    @State private var showCreateFood = false
    @State private var showScanner = false
    @State private var selectedFood: Food?
    @State private var selectedRecipe: Recipe?
    @State private var errorMessage: String?

    @Query(sort: \Food.createdAt, order: .reverse) private var allFoods: [Food]
    @Query(sort: \Recipe.createdAt, order: .reverse) private var allRecipes: [Recipe]

    private var localFoods: [Food] {
        if searchText.isEmpty { return Array(allFoods.prefix(10)) }
        return allFoods.filter { $0.name.localizedCaseInsensitiveContains(searchText) }
    }

    private var localRecipes: [Recipe] {
        if searchText.isEmpty { return [] }
        return allRecipes.filter { $0.name.localizedCaseInsensitiveContains(searchText) }
    }

    var body: some View {
        NavigationStack {
            List {
                // Action buttons
                Section {
                    Button {
                        showScanner = true
                    } label: {
                        Label("Scan Barcode", systemImage: "barcode.viewfinder")
                            .font(.subheadline.weight(.medium))
                            .foregroundStyle(Color.hermesOrange)
                    }

                    Button {
                        showCreateFood = true
                    } label: {
                        Label("Create Food", systemImage: "plus.circle")
                            .font(.subheadline.weight(.medium))
                            .foregroundStyle(Color.royalBlue)
                    }
                }

                // Local results
                if !localRecipes.isEmpty {
                    Section("Recipes") {
                        ForEach(localRecipes) { recipe in
                            Button {
                                addRecipeToDiary(recipe)
                            } label: {
                                FoodRow(
                                    name: recipe.name,
                                    detail: "\(Int(recipe.caloriesPerServing)) cal/serving",
                                    calories: recipe.caloriesPerServing
                                )
                            }
                            .tint(.primary)
                        }
                    }
                }

                if !localFoods.isEmpty {
                    Section(searchText.isEmpty ? "Recent Foods" : "My Foods") {
                        ForEach(localFoods) { food in
                            Button {
                                selectedFood = food
                            } label: {
                                FoodRow(
                                    name: food.name,
                                    detail: food.brand.isEmpty ? "\(Int(food.calories)) cal" : "\(food.brand) - \(Int(food.calories)) cal",
                                    calories: food.calories
                                )
                            }
                            .tint(.primary)
                        }
                    }
                }

                // API results
                if !searchText.isEmpty {
                    Section("Search Results") {
                        if isSearching {
                            HStack {
                                ProgressView()
                                    .tint(Color.royalBlue)
                                Text("Searching...")
                                    .foregroundStyle(.secondary)
                            }
                        } else if apiResults.isEmpty && !searchText.isEmpty {
                            Text("No results found")
                                .foregroundStyle(.secondary)
                        } else {
                            ForEach(apiResults) { product in
                                Button {
                                    saveAndSelect(product)
                                } label: {
                                    FoodRow(
                                        name: product.name,
                                        detail: product.brand.isEmpty ? "\(Int(product.calories)) cal" : "\(product.brand) - \(Int(product.calories)) cal",
                                        calories: product.calories
                                    )
                                }
                                .tint(.primary)
                            }
                        }
                    }
                }

                if let errorMessage {
                    Section {
                        Text(errorMessage)
                            .foregroundStyle(.red)
                            .font(.caption)
                    }
                }
            }
            .searchable(text: $searchText, prompt: "Search foods...")
            .onChange(of: searchText) { _, newValue in
                performSearch(query: newValue)
            }
            .navigationTitle("Add to \(mealType.rawValue)")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
            }
            .sheet(isPresented: $showCreateFood) {
                CreateFoodView { food in
                    selectedFood = food
                }
            }
            .sheet(isPresented: $showScanner) {
                BarcodeScannerView { food in
                    selectedFood = food
                }
            }
            .sheet(item: $selectedFood) { food in
                FoodDetailView(food: food, mealType: mealType, date: date)
            }
        }
    }

    private func performSearch(query: String) {
        searchTask?.cancel()
        errorMessage = nil
        guard !query.isEmpty else {
            apiResults = []
            return
        }
        searchTask = Task {
            isSearching = true
            defer { isSearching = false }

            try? await Task.sleep(for: .milliseconds(400)) // debounce
            guard !Task.isCancelled else { return }

            do {
                let results = try await OpenFoodFactsService.shared.searchProducts(query: query)
                if !Task.isCancelled {
                    apiResults = results
                }
            } catch {
                if !Task.isCancelled {
                    errorMessage = "Search failed. Check your connection."
                    apiResults = []
                }
            }
        }
    }

    private func saveAndSelect(_ product: OpenFoodFactsProduct) {
        let food = product.toFood()
        modelContext.insert(food)
        selectedFood = food
    }

    private func addRecipeToDiary(_ recipe: Recipe) {
        let entry = DiaryEntry(
            date: date,
            mealType: mealType,
            recipe: recipe,
            numberOfServings: 1
        )
        modelContext.insert(entry)
        dismiss()
    }
}

private struct FoodRow: View {
    let name: String
    let detail: String
    let calories: Double

    var body: some View {
        HStack {
            VStack(alignment: .leading, spacing: 2) {
                Text(name)
                    .font(.subheadline.weight(.medium))
                    .lineLimit(1)
                Text(detail)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
            Spacer()
            Text("\(Int(calories))")
                .font(.subheadline.bold())
                .foregroundStyle(Color.hermesOrange)
            Text("cal")
                .font(.caption2)
                .foregroundStyle(.secondary)
        }
    }
}
