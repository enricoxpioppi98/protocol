import SwiftUI
import SwiftData

struct RecipeEditorView: View {
    @Environment(\.modelContext) private var modelContext
    @Bindable var recipe: Recipe

    @State private var showAddIngredient = false

    var body: some View {
        List {
            // Recipe info
            Section("Recipe Info") {
                HStack {
                    Text("Name")
                    Spacer()
                    TextField("Recipe name", text: $recipe.name)
                        .multilineTextAlignment(.trailing)
                }
                HStack {
                    Text("Servings")
                    Spacer()
                    TextField("1", value: $recipe.servings, format: .number)
                        .keyboardType(.decimalPad)
                        .multilineTextAlignment(.trailing)
                        .frame(width: 60)
                }
            }

            // Nutrition per serving
            Section("Per Serving") {
                NutritionLabelView(
                    calories: recipe.caloriesPerServing,
                    protein: recipe.proteinPerServing,
                    carbs: recipe.carbsPerServing,
                    fat: recipe.fatPerServing
                )
                .listRowInsets(EdgeInsets())
                .listRowBackground(Color.clear)
            }

            // Ingredients
            Section {
                if recipe.ingredients.isEmpty {
                    Text("No ingredients yet")
                        .foregroundStyle(.secondary)
                        .italic()
                } else {
                    ForEach(recipe.ingredients) { ingredient in
                        IngredientRow(ingredient: ingredient)
                    }
                    .onDelete(perform: deleteIngredients)
                }

                Button {
                    showAddIngredient = true
                } label: {
                    Label("Add Ingredient", systemImage: "plus")
                        .foregroundStyle(Color.royalBlue)
                }
            } header: {
                HStack {
                    Text("Ingredients")
                    Spacer()
                    Text("Total: \(Int(recipe.totalCalories)) cal")
                        .font(.caption)
                }
            }
        }
        .navigationTitle(recipe.name)
        .navigationBarTitleDisplayMode(.inline)
        .sheet(isPresented: $showAddIngredient) {
            IngredientSearchView { food, quantity in
                let ingredient = RecipeIngredient(food: food, quantity: quantity)
                ingredient.recipe = recipe
                recipe.ingredients.append(ingredient)
            }
        }
    }

    private func deleteIngredients(at offsets: IndexSet) {
        for index in offsets {
            let ingredient = recipe.ingredients[index]
            recipe.ingredients.remove(at: index)
            modelContext.delete(ingredient)
        }
    }
}

private struct IngredientRow: View {
    @Bindable var ingredient: RecipeIngredient

    var body: some View {
        HStack {
            VStack(alignment: .leading, spacing: 2) {
                Text(ingredient.food?.name ?? "Unknown")
                    .font(.subheadline)
                Text("\(ingredient.quantity, specifier: "%.1f") serving\(ingredient.quantity == 1 ? "" : "s")")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
            Spacer()
            VStack(alignment: .trailing, spacing: 2) {
                Text("\(Int(ingredient.calories)) cal")
                    .font(.subheadline.bold())
                    .foregroundStyle(Color.hermesOrange)
                HStack(spacing: 4) {
                    Text("P\(Int(ingredient.protein))")
                        .foregroundStyle(Color.royalBlue)
                    Text("C\(Int(ingredient.carbs))")
                        .foregroundStyle(Color.hermesOrange)
                    Text("F\(Int(ingredient.fat))")
                        .foregroundStyle(.pink)
                }
                .font(.system(size: 9))
            }
        }
    }
}

// MARK: - Ingredient Search (simplified food search for recipes)

private struct IngredientSearchView: View {
    @Environment(\.modelContext) private var modelContext
    @Environment(\.dismiss) private var dismiss

    let onAdd: (Food, Double) -> Void

    @State private var searchText = ""
    @State private var apiResults: [OpenFoodFactsProduct] = []
    @State private var isSearching = false
    @State private var searchTask: Task<Void, Never>?
    @State private var selectedFood: Food?
    @State private var quantity = "1"
    @State private var showCreateFood = false

    @Query(sort: \Food.createdAt, order: .reverse) private var allFoods: [Food]

    private var localFoods: [Food] {
        if searchText.isEmpty { return Array(allFoods.prefix(10)) }
        return allFoods.filter { $0.name.localizedCaseInsensitiveContains(searchText) }
    }

    var body: some View {
        NavigationStack {
            if let food = selectedFood {
                // Quantity picker
                Form {
                    Section {
                        Text(food.name)
                            .font(.headline)
                        if !food.brand.isEmpty {
                            Text(food.brand)
                                .foregroundStyle(.secondary)
                        }
                    }

                    Section("Servings") {
                        HStack {
                            TextField("1", text: $quantity)
                                .keyboardType(.decimalPad)
                                .frame(width: 60)
                            Text("servings (\(food.servingSize, specifier: "%.0f")\(food.servingUnit) each)")
                                .foregroundStyle(.secondary)
                        }
                    }

                    Section("Nutrition for \(quantity) serving\(quantity == "1" ? "" : "s")") {
                        let qty = Double(quantity) ?? 1
                        HStack {
                            Text("Calories")
                            Spacer()
                            Text("\(Int(food.calories * qty)) kcal")
                        }
                        HStack {
                            Text("Protein")
                            Spacer()
                            Text("\(food.protein * qty, specifier: "%.1f")g")
                        }
                        HStack {
                            Text("Carbs")
                            Spacer()
                            Text("\(food.carbs * qty, specifier: "%.1f")g")
                        }
                        HStack {
                            Text("Fat")
                            Spacer()
                            Text("\(food.fat * qty, specifier: "%.1f")g")
                        }
                    }
                }
                .navigationTitle("Add Ingredient")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        Button("Back") { selectedFood = nil }
                    }
                    ToolbarItem(placement: .confirmationAction) {
                        Button("Add") {
                            onAdd(food, Double(quantity) ?? 1)
                            dismiss()
                        }
                        .bold()
                    }
                }
            } else {
                // Search
                List {
                    Section {
                        Button {
                            showCreateFood = true
                        } label: {
                            Label("Create Food", systemImage: "plus.circle")
                        }
                    }

                    if !localFoods.isEmpty {
                        Section(searchText.isEmpty ? "Recent" : "My Foods") {
                            ForEach(localFoods) { food in
                                Button {
                                    selectedFood = food
                                } label: {
                                    HStack {
                                        Text(food.name)
                                        Spacer()
                                        Text("\(Int(food.calories)) cal")
                                            .font(.caption)
                                            .foregroundStyle(Color.hermesOrange)
                                    }
                                }
                                .tint(.primary)
                            }
                        }
                    }

                    if !searchText.isEmpty {
                        Section("Search Results") {
                            if isSearching {
                                ProgressView()
                            } else {
                                ForEach(apiResults) { product in
                                    Button {
                                        let food = product.toFood()
                                        modelContext.insert(food)
                                        selectedFood = food
                                    } label: {
                                        HStack {
                                            VStack(alignment: .leading) {
                                                Text(product.name).lineLimit(1)
                                                if !product.brand.isEmpty {
                                                    Text(product.brand).font(.caption).foregroundStyle(.secondary)
                                                }
                                            }
                                            Spacer()
                                            Text("\(Int(product.calories)) cal")
                                                .font(.caption)
                                                .foregroundStyle(Color.hermesOrange)
                                        }
                                    }
                                    .tint(.primary)
                                }
                            }
                        }
                    }
                }
                .searchable(text: $searchText, prompt: "Search foods...")
                .onChange(of: searchText) { _, newValue in
                    performSearch(query: newValue)
                }
                .navigationTitle("Add Ingredient")
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
            }
        }
    }

    private func performSearch(query: String) {
        searchTask?.cancel()
        guard !query.isEmpty else {
            apiResults = []
            return
        }
        searchTask = Task {
            isSearching = true
            defer { isSearching = false }
            try? await Task.sleep(for: .milliseconds(400))
            guard !Task.isCancelled else { return }
            do {
                let results = try await OpenFoodFactsService.shared.searchProducts(query: query)
                if !Task.isCancelled { apiResults = results }
            } catch {
                if !Task.isCancelled { apiResults = [] }
            }
        }
    }
}
