import SwiftUI
import SwiftData

struct FoodSearchView: View {
    @Environment(\.modelContext) private var modelContext
    @Environment(\.dismiss) private var dismiss

    let mealType: MealType
    let date: Date

    @State private var searchText = ""
    @State private var usdaResults: [FoodProduct] = []
    @State private var offResults: [FoodProduct] = []
    @State private var isSearchingUSDA = false
    @State private var isSearchingOFF = false
    @State private var searchTask: Task<Void, Never>?
    @State private var showCreateFood = false
    @State private var showScanner = false
    @State private var selectedFood: Food?
    @State private var selectedRecipe: Recipe?
    @State private var usdaError: String?
    @State private var offError: String?

    @Query(sort: \Food.createdAt, order: .reverse) private var allFoods: [Food]
    @Query(sort: \Recipe.createdAt, order: .reverse) private var allRecipes: [Recipe]

    private var favoriteFoods: [Food] {
        allFoods.filter { $0.isFavorite }
    }

    private var localFoods: [Food] {
        if searchText.isEmpty { return Array(allFoods.prefix(10)) }
        return allFoods.filter { $0.name.localizedCaseInsensitiveContains(searchText) }
    }

    private var localRecipes: [Recipe] {
        if searchText.isEmpty { return [] }
        return allRecipes.filter { $0.name.localizedCaseInsensitiveContains(searchText) }
    }

    private var isSearching: Bool {
        isSearchingUSDA || isSearchingOFF
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
                            .foregroundStyle(Color.highlight)
                    }

                    Button {
                        showCreateFood = true
                    } label: {
                        Label("Create Food", systemImage: "plus.circle")
                            .font(.subheadline.weight(.medium))
                            .foregroundStyle(Color.accent)
                    }
                }

                // Favorites
                if searchText.isEmpty && !favoriteFoods.isEmpty {
                    Section("Favorites") {
                        ForEach(favoriteFoods) { food in
                            Button {
                                selectedFood = food
                            } label: {
                                HStack(spacing: 6) {
                                    Image(systemName: "star.fill")
                                        .font(.caption2)
                                        .foregroundStyle(Color.highlight)
                                    FoodRow(
                                        name: food.name,
                                        detail: food.brand.isEmpty ? "\(Int(food.calories)) cal" : "\(food.brand) - \(Int(food.calories)) cal",
                                        calories: food.calories
                                    )
                                }
                            }
                            .tint(.primary)
                            .swipeActions(edge: .leading) {
                                Button {
                                    food.isFavorite = false
                                } label: {
                                    Label("Unfavorite", systemImage: "star.slash")
                                }
                                .tint(Color.highlight)
                            }
                        }
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
                                HStack(spacing: 6) {
                                    if food.isFavorite {
                                        Image(systemName: "star.fill")
                                            .font(.caption2)
                                            .foregroundStyle(Color.highlight)
                                    }
                                    FoodRow(
                                        name: food.name,
                                        detail: food.brand.isEmpty ? "\(Int(food.calories)) cal" : "\(food.brand) - \(Int(food.calories)) cal",
                                        calories: food.calories
                                    )
                                }
                            }
                            .tint(.primary)
                            .swipeActions(edge: .leading) {
                                Button {
                                    food.isFavorite.toggle()
                                    UIImpactFeedbackGenerator(style: .light).impactOccurred()
                                } label: {
                                    Label(
                                        food.isFavorite ? "Unfavorite" : "Favorite",
                                        systemImage: food.isFavorite ? "star.slash" : "star.fill"
                                    )
                                }
                                .tint(Color.highlight)
                            }
                        }
                    }
                }

                // USDA Branded Foods
                if !searchText.isEmpty {
                    Section {
                        if isSearchingUSDA {
                            HStack {
                                ProgressView()
                                    .tint(Color.accent)
                                Text("Searching USDA...")
                                    .foregroundStyle(.secondary)
                                    .font(.subheadline)
                            }
                        } else if usdaResults.isEmpty {
                            Text("No USDA results")
                                .foregroundStyle(.secondary)
                                .font(.caption)
                        } else {
                            ForEach(usdaResults) { product in
                                Button {
                                    saveAndSelect(product)
                                } label: {
                                    FoodRow(
                                        name: product.name,
                                        detail: product.brand.isEmpty
                                            ? "\(Int(product.calories)) cal"
                                            : "\(product.brand) - \(Int(product.calories)) cal",
                                        calories: product.calories
                                    )
                                }
                                .tint(.primary)
                            }
                        }
                    } header: {
                        HStack {
                            Text("USDA Branded Foods")
                            Spacer()
                            Image(systemName: "building.columns")
                                .font(.caption2)
                                .foregroundStyle(.secondary)
                        }
                    }
                }

                // OpenFoodFacts Results
                if !searchText.isEmpty {
                    Section {
                        if isSearchingOFF {
                            HStack {
                                ProgressView()
                                    .tint(Color.accent)
                                Text("Searching OpenFoodFacts...")
                                    .foregroundStyle(.secondary)
                                    .font(.subheadline)
                            }
                        } else if offResults.isEmpty {
                            Text("No OpenFoodFacts results")
                                .foregroundStyle(.secondary)
                                .font(.caption)
                        } else {
                            ForEach(offResults) { product in
                                Button {
                                    saveAndSelect(product)
                                } label: {
                                    FoodRow(
                                        name: product.name,
                                        detail: product.brand.isEmpty
                                            ? "\(Int(product.calories)) cal"
                                            : "\(product.brand) - \(Int(product.calories)) cal",
                                        calories: product.calories
                                    )
                                }
                                .tint(.primary)
                            }
                        }
                    } header: {
                        HStack {
                            Text("OpenFoodFacts")
                            Spacer()
                            Image(systemName: "globe")
                                .font(.caption2)
                                .foregroundStyle(.secondary)
                        }
                    }
                }

                // Error messages
                if let usdaError {
                    Section {
                        Text(usdaError)
                            .foregroundStyle(.red)
                            .font(.caption)
                    }
                }
                if let offError {
                    Section {
                        Text(offError)
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
            .navigationDestination(item: $selectedFood) { food in
                FoodDetailView(food: food, mealType: mealType, date: date)
            }
        }
    }

    // MARK: - Parallel Search

    private func performSearch(query: String) {
        searchTask?.cancel()
        usdaError = nil
        offError = nil

        guard !query.isEmpty else {
            usdaResults = []
            offResults = []
            return
        }

        searchTask = Task {
            isSearchingUSDA = true
            isSearchingOFF = true

            try? await Task.sleep(for: .milliseconds(400)) // debounce
            guard !Task.isCancelled else { return }

            // Fire both API searches in parallel
            async let usdaSearch = USDAFoodService.shared.searchProducts(query: query)
            async let offSearch = OpenFoodFactsService.shared.searchProducts(query: query)

            // Collect USDA results
            do {
                let usda = try await usdaSearch
                if !Task.isCancelled { usdaResults = usda }
            } catch {
                if !Task.isCancelled {
                    usdaError = "USDA search failed."
                    usdaResults = []
                }
            }
            isSearchingUSDA = false

            // Collect OpenFoodFacts results
            do {
                let off = try await offSearch
                if !Task.isCancelled { offResults = off }
            } catch {
                if !Task.isCancelled {
                    offError = "OpenFoodFacts search failed."
                    offResults = []
                }
            }
            isSearchingOFF = false
        }
    }

    private func saveAndSelect(_ product: FoodProduct) {
        let food = product.toFood()
        modelContext.insert(food)
        try? modelContext.save()
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
        try? modelContext.save()
        UINotificationFeedbackGenerator().notificationOccurred(.success)
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
                .foregroundStyle(Color.highlight)
            Text("cal")
                .font(.caption2)
                .foregroundStyle(.secondary)
        }
    }
}
